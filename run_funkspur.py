#!/usr/bin/env python3
"""Serve Funkspur and its Wi-Fi scanner on this computer only."""
import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading
import webbrowser

from tools.wifi_scan import ScanError, for_host

ASSETS = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/survey.js': ('survey.js', 'text/javascript; charset=utf-8'),
    '/live.js': ('live.js', 'text/javascript; charset=utf-8'),
    '/live-model.js': ('live-model.js', 'text/javascript; charset=utf-8'),
    '/style.css': ('style.css', 'text/css; charset=utf-8'),
}
ROOT = Path(__file__).resolve().parent
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


class FunkspurServer(ThreadingHTTPServer):
    def __init__(self, port, scanner=None):
        super().__init__(('127.0.0.1', port), Handler)
        self.host = f'127.0.0.1:{self.server_port}'
        self.origin = 'http://' + self.host
        self.token = secrets.token_urlsafe(32)
        self.scanner = scanner
        self.scan_lock = threading.Lock()

    def adapter(self):
        if self.scanner is None:
            self.scanner = for_host()
        return self.scanner


class Handler(BaseHTTPRequestHandler):
    server: FunkspurServer

    def log_message(self, *_):
        # No requests, adapter information, or survey contents are logged.
        pass

    def respond(self, status, data, content_type):
        self.send_response(status)
        for key, value in {
            'Content-Type': content_type, 'Content-Length': str(len(data)),
            'Cache-Control': 'no-store', 'Content-Security-Policy': CSP,
            'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
        }.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def reply(self, status, **payload):
        self.respond(status, json.dumps(payload, ensure_ascii=True).encode(), 'application/json; charset=utf-8')

    def local_request(self):
        if self.headers.get_all('Host') != [self.server.host]:
            self.reply(HTTPStatus.FORBIDDEN, error='Nur die lokale Funkspur-Adresse ist erlaubt.')
            return False
        if self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
            self.reply(HTTPStatus.FORBIDDEN, error='Anfrage einer anderen Website abgelehnt.')
            return False
        return True

    def do_GET(self):
        if not self.local_request():
            return
        if self.path in ASSETS:
            path, content_type = ASSETS[self.path]
            self.respond(HTTPStatus.OK, (ROOT / path).read_bytes(), content_type)
        elif self.path == '/api/status':
            try:
                adapters = self.server.adapter().adapters()
                self.reply(HTTPStatus.OK, adapters=adapters, token=self.server.token)
            except (ScanError, OSError) as e:
                self.reply(HTTPStatus.SERVICE_UNAVAILABLE, error=str(e))
        else:
            self.reply(HTTPStatus.NOT_FOUND, error='Nicht gefunden.')

    def do_POST(self):
        if not self.local_request():
            return
        if self.path != '/api/scan':
            self.reply(HTTPStatus.NOT_FOUND, error='Nicht gefunden.')
            return
        supplied = self.headers.get('X-Funkspur-Token', '').encode('utf-8')
        if (self.headers.get_all('Origin') != [self.server.origin]
                or not secrets.compare_digest(supplied, self.server.token.encode('ascii'))):
            self.reply(HTTPStatus.FORBIDDEN, error='Nur die geöffnete Funkspur-App darf einen Scan starten.')
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2048 or self.headers.get_content_type() != 'application/json':
                raise ValueError()
            self.connection.settimeout(3)
            request = json.loads(self.rfile.read(size))
            interface = request['adapter']
            if not isinstance(interface, str) or len(interface) > 100:
                raise ValueError()
        except (ValueError, KeyError, TypeError, TimeoutError, UnicodeError):
            self.reply(HTTPStatus.BAD_REQUEST, error='Ungültige Scan-Anfrage.')
            return
        self.connection.settimeout(10)
        if not self.server.scan_lock.acquire(blocking=False):
            self.reply(HTTPStatus.CONFLICT, error='Ein anderer Scan läuft bereits.')
            return
        try:
            scanner = self.server.adapter()
            if interface not in {item['id'] for item in scanner.adapters()}:
                self.reply(HTTPStatus.BAD_REQUEST, error='WLAN-Adapter nicht gefunden. Adapterliste aktualisieren.')
                return
            self.reply(HTTPStatus.OK, radios=scanner.scan(interface), source=scanner.source)
        except (ScanError, OSError) as e:
            self.reply(HTTPStatus.SERVICE_UNAVAILABLE, error=str(e))
        finally:
            self.server.scan_lock.release()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port', type=int, default=8765)
    p.add_argument('--no-browser', action='store_true')
    args = p.parse_args()
    if not 1 <= args.port <= 65535:
        p.error('Port muss zwischen 1 und 65535 liegen.')
    try:
        with FunkspurServer(args.port) as server:
            print(f'Funkspur läuft lokal auf {server.origin}/ (Strg+C zum Beenden).', flush=True)
            if not args.no_browser:
                webbrowser.open(server.origin + '/')
            server.serve_forever()
    except KeyboardInterrupt:
        print('\nFunkspur beendet.')
    except OSError as error:
        p.exit(1, f'Funkspur konnte nicht starten: {error}\n')


if __name__ == '__main__':
    main()
