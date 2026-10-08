#!/usr/bin/env python3
"""Local preview, bound to loopback only. No external packages required."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def do_POST(self):
        match = re.fullmatch(r'/__preview/(all|living|master|guest|kitchen|bath|balcony)-(day|night)\.png', self.path)
        size = int(self.headers.get('Content-Length', '0'))
        if not match or not 0 < size < 15_000_000:
            self.send_error(400); return
        content = self.rfile.read(size)
        if not content.startswith(b'\x89PNG\r\n\x1a\n'):
            self.send_error(400); return
        folder = ROOT / 'previews'; folder.mkdir(exist_ok=True)
        (folder / (match[1] + '-' + match[2] + '.png')).write_bytes(content)
        self.send_response(204); self.end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=18770)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT)))
    print(f'V7 preview: http://127.0.0.1:{args.port}/', flush=True)
    server.serve_forever()
