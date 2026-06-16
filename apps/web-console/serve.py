"""
Minimal HTTP server for web-console dist with SPA fallback.
All non-file requests serve index.html.
"""
import http.server
import os
import sys
import re
from pathlib import Path

PORT = 5200
DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        # Try to serve the file
        file_path = os.path.join(DIST, self.path.lstrip('/'))
        if os.path.isfile(file_path):
            return super().do_GET()
        # SPA fallback: serve index.html
        self.path = '/index.html'
        return super().do_GET()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

if __name__ == '__main__':
    print(f'Web Console @ http://localhost:{PORT}')
    print(f'Serving: {DIST}')
    http.server.HTTPServer(('127.0.0.1', PORT), SPAHandler).serve_forever()
