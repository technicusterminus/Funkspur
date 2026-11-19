import ctypes
import json
import time
from http.client import HTTPConnection
import threading
import unittest

from run_funkspur import FunkspurServer
from tools.wifi_scan import BssEntry, BssList, EPOCH_DELTA_100NS, ScanError, parse_linux_scan, parse_windows_bss, radio

LINUX = '''
BSS 02:00:00:00:00:01(on wlan0)
\tfreq: 5180
\tsignal: -53.75 dBm
\tlast seen: 226 ms ago
\tSSID: Example Lab
BSS 02:00:00:00:00:02(on wlan0)
\tfreq: 2412
\tsignal: -69.00 dBm
\tlast seen: 8230 ms ago
\tSSID: Old cached radio
BSS 02:00:00:00:00:03(on wlan0)
\tfreq: 5955
\tsignal: 98/100
\tlast seen: 30 ms ago
\tSSID: Not in dBm
BSS 02:00:00:00:00:04(on wlan0)
\tfreq: 5955
\tsignal: -64.00 dBm
\tlast seen: 30 ms ago
\tSSID:
BSS 02:00:00:00:00:05(on wlan0)
\tfreq: 5180
\tsignal: -62.00 dBm
\tSSID: No known age
'''


class FixtureAdapter:
    """Synthetic signals for integration tests only. Never loaded by the application."""
    source = 'test-fixture'

    def __init__(self):
        self.scans = 0

    def adapters(self):
        return [{'id': 'fixture', 'name': 'Synthetic test adapter'}]

    def scan(self, interface):
        self.scans += 1
        now = time.time()
        return [radio('Example Lab', '02:00:00:00:00:01', 5180, -53, now),
                radio('Example Lab', '02:00:00:00:00:05', 5200, -61, now),
                radio('Other SSID', '02:00:00:00:00:09', 2412, -70, now)]


class ScannerParserTest(unittest.TestCase):
    def test_iw_uses_fresh_dbm_only_preserves_hidden_ssids(self):
        rows = parse_linux_scan(LINUX, 1700000010, 1700000005)
        self.assertEqual([(r['bssid'], r['rssi_dbm'], r['channel'], r['ssid']) for r in rows],
                         [('02:00:00:00:00:01', -53.75, 36, 'Example Lab'),
                          ('02:00:00:00:00:04', -64, 1, '')])

    def test_windows_abi_and_fresh_entry(self):
        self.assertEqual((ctypes.sizeof(BssEntry), BssEntry.host_timestamp.offset,
                          BssEntry.frequency_khz.offset, BssList.entries.offset), (360, 80, 92, 8))
        started = 1700000000000000000
        header = (8 + 2 * ctypes.sizeof(BssEntry)).to_bytes(4, 'little') + (2).to_bytes(4, 'little')
        entry = BssEntry()
        entry.bss_type = 1
        entry.ssid.length = 3
        entry.ssid.value[:3] = b'Lab'
        entry.bssid[:] = bytes.fromhex('020000000001')
        entry.frequency_khz = 5955000
        entry.rssi = -61
        entry.host_timestamp = EPOCH_DELTA_100NS + started // 100 + 1_000_000
        fresh = bytes(entry)
        entry.host_timestamp = EPOCH_DELTA_100NS + started // 100 - 1
        old = bytes(entry)
        self.assertEqual(parse_windows_bss(header + fresh + old, started),
                         [radio('Lab', '02:00:00:00:00:01', 5955, -61, started / 1e9 + 0.1)])
        with self.assertRaises(ScanError):
            parse_windows_bss(header + fresh, started)


class LocalApiTest(unittest.TestCase):
    def setUp(self):
        self.adapter = FixtureAdapter()
        self.server = FunkspurServer(0, self.adapter)
        self.worker = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.02})
        self.worker.start()
        self.addCleanup(self.worker.join)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, body=None, headers=None):
        conn = HTTPConnection('127.0.0.1', self.server.server_port, timeout=4)
        try:
            conn.request(method, path, body, headers or {})
            res = conn.getresponse()
            return res.status, res.headers, res.read()
        finally:
            conn.close()

    def test_serves_only_app_static_files_and_stays_local(self):
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn(b'Funkspur', body)
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertIsNone(headers.get('Access-Control-Allow-Origin'))
        for path in ('/live.js', '/live-model.js'):
            self.assertEqual(self.request('GET', path)[0], 200)
        for path in ('/README.md', '/tools/wifi_scan.py', '/.git/config', '/../index.html'):
            self.assertEqual(self.request('GET', path)[0], 404)
        self.assertEqual(self.request('GET', '/api/status', headers={'Host': 'other.test'})[0], 403)
        self.assertEqual(self.request('GET', '/api/status', headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)

    def test_scan_requires_local_origin_token_and_a_listed_adapter(self):
        status, _, payload = self.request('GET', '/api/status')
        self.assertEqual(status, 200)
        token = json.loads(payload)['token']
        headers = {'Origin': self.server.origin, 'Content-Type': 'application/json', 'X-Funkspur-Token': token}
        body = json.dumps({'adapter': 'fixture'})
        self.assertEqual(self.request('POST', '/api/scan', body, {**headers, 'Origin': 'https://other.test'})[0], 403)
        self.assertEqual(self.request('POST', '/api/scan', body, {**headers, 'X-Funkspur-Token': 'bad'})[0], 403)
        self.assertEqual(self.request('POST', '/api/scan', '{"adapter":"not-an-adapter"}', headers)[0], 400)
        self.assertEqual(self.adapter.scans, 0)
        status, _, payload = self.request('POST', '/api/scan', body, headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(payload)['radios'][0]['rssi_dbm'], -53)
        self.assertEqual(self.adapter.scans, 1)


if __name__ == '__main__':
    unittest.main()
