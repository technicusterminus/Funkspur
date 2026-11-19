"""Local Windows and Linux Wi-Fi survey adapters. Only native dBm readings."""
import ctypes as c
from datetime import datetime, timezone
import os
import re
import shutil
import subprocess
import sys
import time
from threading import Event
from uuid import UUID
try:
    from .record_linux import channel_for
except ImportError:
    from record_linux import channel_for

EPOCH_DELTA_100NS = 116444736000000000
MAX_RADIOS = 512
MAC = r'(?:[0-9a-f]{2}:){5}[0-9a-f]{2}'


class ScanError(Exception):
    """A condition the survey operator can act on."""


def stamp(unix_seconds):
    return datetime.fromtimestamp(unix_seconds, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def radio(ssid, bssid, frequency, dbm, seen):
    if not (-127 <= dbm < 0 and re.fullmatch(MAC, bssid, re.I) and frequency > 0):
        return None
    band, channel = channel_for(frequency)
    return dict(ssid=ssid[:100], bssid=bssid.lower(), band=band, channel=channel or None,
                rssi_dbm=dbm, frequency_mhz=frequency, observed_at=stamp(seen))


def newest_radios(radios):
    by_key = {}
    for item in radios:
        if not item:
            continue
        key = (item['bssid'], item['frequency_mhz'])
        prev = by_key.get(key)
        if not prev or (item['observed_at'], item['rssi_dbm']) > (prev['observed_at'], prev['rssi_dbm']):
            by_key[key] = item
    return sorted(by_key.values(), key=lambda x: (-x['rssi_dbm'], x['bssid']))[:MAX_RADIOS]


def parse_linux_scan(output, read_at, scan_started):
    """Discard BSS cache entries already seen before this scan request."""
    matches = re.split(r'^BSS (' + MAC + r')(?=\s|\()', output, flags=re.M | re.I)
    found = []
    for mac, block in zip(matches[1::2], matches[2::2]):
        ssid = re.search(r'^[ \t]+SSID:[ \t]?([^\r\n]*)', block, re.M)
        freq = re.search(r'^[ \t]+freq:\s*(\d+)', block, re.M)
        rssi = re.search(r'^[ \t]+signal:\s*(-?\d+(?:\.\d+)?)\s+dBm\b', block, re.M)
        age = re.search(r'^[ \t]+last seen:\s*(\d+)\s+ms ago\b', block, re.M)
        if not (freq and rssi and age):
            continue
        seen = read_at - int(age[1]) / 1000
        if seen >= scan_started:
            found.append(radio(ssid[1] if ssid else '', mac, int(freq[1]), float(rssi[1]), seen))
    return newest_radios(found)


def run_linux(*command):
    try:
        return subprocess.run(command, check=True, capture_output=True, text=True,
                              errors='replace', timeout=18, env={**os.environ, 'LC_ALL': 'C'}).stdout
    except FileNotFoundError as e:
        raise ScanError(f'{command[0]} wurde nicht gefunden.') from e
    except subprocess.TimeoutExpired as e:
        raise ScanError(f'{command[0]} hat nicht rechtzeitig geantwortet.') from e


class LinuxScanner:
    source = 'linux-iw'

    def adapters(self):
        try:
            output = run_linux('iw', 'dev')
        except subprocess.CalledProcessError as e:
            raise ScanError('WLAN-Adapter konnten mit iw nicht gelesen werden.') from e
        names = re.findall(r'^\s*Interface\s+([A-Za-z0-9_.:-]{1,15})\s*$', output, re.M)
        return [dict(id=name, name=name) for name in dict.fromkeys(names) if not name.startswith('-')]

    def scan(self, interface):
        started_mono = time.monotonic()
        try:
            output = run_linux('iw', 'dev', interface, 'scan')
        except subprocess.CalledProcessError as e:
            if shutil.which('nmcli'):
                started_mono = time.monotonic()
                try:
                    # NetworkManager requests a scan. Its percentage values are never used.
                    run_linux('nmcli', '--wait', '12', 'device', 'wifi', 'list',
                              '--rescan', 'yes', 'ifname', interface)
                    output = run_linux('iw', 'dev', interface, 'scan', 'dump')
                except (ScanError, subprocess.CalledProcessError) as fallback:
                    raise ScanError('Kein WLAN-Scan möglich. Adapter, Funkstatus und Scanrechte '
                                    'in Linux bzw. NetworkManager prüfen.') from fallback
            else:
                raise ScanError('Der Adapter konnte nicht scannen. Adapter, Funkstatus und Scanrechte prüfen. '
                                'Ohne Scan kannst du einen verbundenen AP mit record_linux.py messen.') from e
        # Build the wall-clock cut-off from elapsed monotonic time.
        now = time.time()
        return parse_linux_scan(output, now, now - (time.monotonic() - started_mono))


# Fixed-width Windows C scalar types. Declaration also importable on Linux for ABI tests.
DWORD, LONG, USHORT, BYTE = c.c_uint32, c.c_int32, c.c_uint16, c.c_ubyte
PVOID, QWORD = c.c_void_p, c.c_uint64


class GUID(c.Structure):
    _fields_ = [('data1', DWORD), ('data2', USHORT), ('data3', USHORT), ('data4', BYTE * 8)]


class Interface(c.Structure):
    _fields_ = [('guid', GUID), ('description', USHORT * 256), ('state', DWORD)]


class SSID(c.Structure):
    _fields_ = [('length', DWORD), ('value', BYTE * 32)]


class RateSet(c.Structure):
    _fields_ = [('length', DWORD), ('values', USHORT * 126)]


class BssEntry(c.Structure):
    _fields_ = [('ssid', SSID), ('phy_id', DWORD), ('bssid', BYTE * 6), ('bss_type', DWORD),
                ('phy_type', DWORD), ('rssi', LONG), ('quality', DWORD), ('in_reg_domain', BYTE),
                ('beacon_period', USHORT), ('timestamp', QWORD), ('host_timestamp', QWORD),
                ('capabilities', USHORT), ('frequency_khz', DWORD), ('rate_set', RateSet),
                ('ie_offset', DWORD), ('ie_size', DWORD)]


class BssList(c.Structure):
    _fields_ = [('size', DWORD), ('count', DWORD), ('entries', BssEntry * 1)]


class Notification(c.Structure):
    _fields_ = [('source', DWORD), ('code', DWORD), ('guid', GUID), ('data_size', DWORD), ('data', PVOID)]


def parse_windows_bss(buffer, started_ns):
    minimum = BssList.entries.offset
    if len(buffer) < minimum:
        raise ScanError('Windows hat eine unvollständige BSS-Liste geliefert.')
    size, count = (DWORD * 2).from_buffer_copy(buffer)
    if size > len(buffer) or size < minimum or count > (size - minimum) // c.sizeof(BssEntry):
        raise ScanError('Windows hat eine ungültige BSS-Liste geliefert.')
    cutoff = EPOCH_DELTA_100NS + started_ns // 100
    found = []
    for i in range(count):
        entry = BssEntry.from_buffer_copy(buffer, minimum + i * c.sizeof(BssEntry))
        if entry.host_timestamp < cutoff or entry.frequency_khz % 1000 or entry.bss_type != 1:
            continue
        seen = (entry.host_timestamp - EPOCH_DELTA_100NS) / 10_000_000
        # Ignore malformed or future timestamps before converting to datetime.
        if not 0 < seen <= time.time() + 5:
            continue
        ssid = bytes(entry.ssid.value[:min(entry.ssid.length, 32)]).decode('utf-8', 'replace')
        found.append(radio(ssid, bytes(entry.bssid).hex(':'), entry.frequency_khz // 1000, entry.rssi, seen))
    return newest_radios(found)


class WindowsScanner:
    source = 'windows-wlanapi'

    def __init__(self):
        if c.sizeof(BssEntry) != 360 or c.sizeof(Interface) != 532:
            raise ScanError('Diese Python/Windows-Architektur wird nicht unterstützt.')
        self.api = c.WinDLL('wlanapi.dll')
        self.callback_type = c.WINFUNCTYPE(None, c.POINTER(Notification), PVOID)
        for name, args in {
            'WlanOpenHandle': [DWORD, PVOID, c.POINTER(DWORD), c.POINTER(PVOID)],
            'WlanCloseHandle': [PVOID, PVOID],
            'WlanEnumInterfaces': [PVOID, PVOID, c.POINTER(PVOID)],
            'WlanScan': [PVOID, c.POINTER(GUID), PVOID, PVOID, PVOID],
            'WlanRegisterNotification': [PVOID, DWORD, LONG, self.callback_type, PVOID, PVOID, c.POINTER(DWORD)],
            'WlanGetNetworkBssList': [PVOID, c.POINTER(GUID), PVOID, DWORD, LONG, PVOID, c.POINTER(PVOID)],
        }.items():
            fn = getattr(self.api, name)
            fn.argtypes, fn.restype = args, DWORD
        self.api.WlanFreeMemory.argtypes, self.api.WlanFreeMemory.restype = [PVOID], None

    @staticmethod
    def check(code, operation):
        if code == 5:
            raise ScanError('Windows verweigert den WLAN-Zugriff. Unter Einstellungen → Datenschutz '
                            'und Sicherheit → Standort den Zugriff für Desktop-Apps prüfen.')
        if code:
            raise ScanError(f'{operation} fehlgeschlagen (Windows-Fehler {code}). WLAN und Adapter prüfen.')

    def open(self):
        version, handle = DWORD(), PVOID()
        self.check(self.api.WlanOpenHandle(2, None, c.byref(version), c.byref(handle)), 'WLAN öffnen')
        return handle

    def adapters(self):
        handle, memory = self.open(), PVOID()
        try:
            self.check(self.api.WlanEnumInterfaces(handle, None, c.byref(memory)), 'Adapter abfragen')
            address = memory.value
            if not address:
                return []
            count = DWORD.from_address(address).value
            if count > 128:
                raise ScanError('Windows hat eine ungültige Adapterliste geliefert.')
            adapters = []
            for i in range(count):
                row = Interface.from_address(address + 8 + i * c.sizeof(Interface))
                text = bytes(row.description).decode('utf-16-le', 'replace').split('\x00', 1)[0]
                adapters.append(dict(id=str(UUID(bytes_le=bytes(row.guid))), name=text))
            return adapters
        finally:
            if memory:
                self.api.WlanFreeMemory(memory)
            self.api.WlanCloseHandle(handle, None)

    def scan(self, interface):
        guid = GUID.from_buffer_copy(UUID(interface).bytes_le)
        handle, memory = self.open(), PVOID()
        done, failure = Event(), []
        acm = 0x00000008

        @self.callback_type
        def callback(info, _context):
            if info and info.contents.source == acm and bytes(info.contents.guid) == bytes(guid):
                if info.contents.code in (7, 8):
                    if info.contents.code == 8:
                        failure.append(True)
                    done.set()

        try:
            self.check(self.api.WlanRegisterNotification(handle, acm, 0, callback, None, None, None),
                       'Scan-Rückmeldung abonnieren')
            started = time.time_ns()
            self.check(self.api.WlanScan(handle, c.byref(guid), None, None, None), 'WLAN scannen')
            if not done.wait(8):
                raise ScanError('Der Adapter hat den Scan nicht bestätigt. Am Messort erneut scannen.')
            if failure:
                raise ScanError('Der WLAN-Treiber meldet einen fehlgeschlagenen Scan.')
            self.check(self.api.WlanGetNetworkBssList(handle, c.byref(guid), None, 3, 0, None, c.byref(memory)),
                       'WLAN-Messwerte lesen')
            if not memory:
                return []
            size = DWORD.from_address(memory.value).value
            if size < BssList.entries.offset or size > 32_000_000:
                raise ScanError('Windows hat eine ungültige BSS-Listengrösse geliefert.')
            return parse_windows_bss(c.string_at(memory, size), started)
        finally:
            if memory:
                self.api.WlanFreeMemory(memory)
            self.api.WlanRegisterNotification(handle, 0, 0, self.callback_type(), None, None, None)
            self.api.WlanCloseHandle(handle, None)


def for_host():
    if sys.platform == 'win32':
        return WindowsScanner()
    if sys.platform.startswith('linux'):
        return LinuxScanner()
    raise ScanError('Direkter WLAN-Scan ist in dieser Version unter Windows und Linux verfügbar. CSV bleibt nutzbar.')
