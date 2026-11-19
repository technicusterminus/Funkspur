import unittest
from tools.record_linux import channel_for, parse_link, text_cell


class CollectorTest(unittest.TestCase):
    def test_channel_bands(self):
        for mhz, result in ((2412, ('2.4 GHz', 1)), (2484, ('2.4 GHz', 14)),
                            (5180, ('5 GHz', 36)), (5955, ('6 GHz', 1)),
                            (5935, ('6 GHz', 2)), (1000, ('Unbekannt', ''))):
            with self.subTest(mhz=mhz):
                self.assertEqual(channel_for(mhz), result)

    def test_parse_real_format(self):
        sample = 'Connected to AA:BB:CC:DD:EE:FF (on wlp2s0)\n\tSSID: a, b\n\tfreq: 5180\n\tsignal: -47.5 dBm\n'
        self.assertEqual(parse_link(sample), (-47.5, 'a, b', '5 GHz', 'aa:bb:cc:dd:ee:ff', 36))

    def test_disconnected(self):
        with self.assertRaises(ValueError):
            parse_link('Not connected.\n')

    def test_escape_spreadsheet_text(self):
        self.assertEqual(text_cell("  =2+2"), "'  =2+2")
        self.assertEqual(text_cell("'notes"), "''notes")
