#!/usr/bin/env python3
"""Append one actual connected-radio RSSI reading from Linux iw to a survey CSV."""
import argparse
import csv
import os
import re
import subprocess
from pathlib import Path

COLUMNS = ('x_pct', 'y_pct', 'rssi_dbm', 'ssid', 'band', 'bssid', 'channel', 'note')


def text_cell(value):
    if value.startswith(("'", "\t", "\r", "\n")) or value.lstrip().lstrip('\ufeff').lstrip().startswith(('=', '+', '@', '-')):
        return "'" + value
    return value


def channel_for(mhz):
    if mhz == 2484:
        return '2.4 GHz', 14
    if 2412 <= mhz <= 2472 and (mhz - 2407) % 5 == 0:
        return '2.4 GHz', (mhz - 2407) // 5
    if mhz == 5935:
        return '6 GHz', 2
    if 5955 <= mhz <= 7115 and (mhz - 5950) % 5 == 0:
        return '6 GHz', (mhz - 5950) // 5
    if 5005 <= mhz <= 5895 and (mhz - 5000) % 5 == 0:
        return '5 GHz', (mhz - 5000) // 5
    return 'Unbekannt', ''


def parse_link(output):
    bssid = re.search(r'^Connected to ((?:[a-f0-9]{2}:){5}[a-f0-9]{2})\b', output, re.M | re.I)
    rssi = re.search(r'^\s*signal:\s*(-?\d+(?:\.\d+)?)\s+dBm(?=\s|$)', output, re.M)
    freq = re.search(r'^\s*freq:\s*(\d+)', output, re.M)
    ssid = re.search(r'^[ \t]*SSID: ([^\r\n]*)', output, re.M)
    if not bssid or not rssi:
        raise ValueError('Kein verbundener WLAN-Link mit RSSI in dBm gefunden.')
    signal = float(rssi[1])
    if not -127 <= signal <= 0:
        raise ValueError('RSSI liegt ausserhalb des unterstützten Bereichs.')
    band, channel = channel_for(int(freq[1])) if freq else ('Unbekannt', '')
    return signal, ssid[1] if ssid else '', band, bssid[1].lower(), channel


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('interface', help='WLAN-Interface, z. B. wlp2s0')
    p.add_argument('csv', type=Path)
    p.add_argument('--x', required=True, type=float, help='X in Prozent (0 links, 100 rechts)')
    p.add_argument('--y', required=True, type=float, help='Y in Prozent (0 oben, 100 unten)')
    p.add_argument('--note', default='')
    args = p.parse_args()
    if not (0 <= args.x <= 100 and 0 <= args.y <= 100):
        p.error('X/Y müssen zwischen 0 und 100 liegen.')
    if not re.fullmatch(r'[a-zA-Z0-9_.:-]{1,15}', args.interface) or args.interface.startswith('-'):
        p.error('Ungültiger Interface-Name.')
    if len(args.note) > 500:
        p.error('Notiz darf höchstens 500 Zeichen haben.')
    try:
        result = subprocess.run(['iw', 'dev', args.interface, 'link'], check=True, capture_output=True,
                                text=True, errors='replace', timeout=5, env={**os.environ, 'LC_ALL': 'C'})
        signal, ssid, band, bssid, channel = parse_link(result.stdout)
        new_file = not args.csv.exists() or args.csv.stat().st_size == 0
        if not new_file:
            with args.csv.open(encoding='utf-8-sig', newline='') as f:
                if tuple(next(csv.reader(f), ())) != COLUMNS:
                    raise ValueError('Vorhandene CSV hat nicht das erwartete Spaltenschema.')
            with args.csv.open('rb') as f:
                f.seek(-1, os.SEEK_END)
                if f.read(1) not in (b'\n', b'\r'):
                    raise ValueError('Vorhandene CSV endet nicht mit einem Zeilenumbruch.')
        with args.csv.open('a', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            if new_file:
                writer.writerow(COLUMNS)
            writer.writerow((args.x, args.y, signal, text_cell(ssid), band, bssid, channel, text_cell(args.note)))
        print(f'{signal:g} dBm, {band}, {bssid} → {args.csv}')
    except subprocess.CalledProcessError as error:
        p.exit(1, f'iw fehlgeschlagen: {error.stderr.strip()}\n')
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        p.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
