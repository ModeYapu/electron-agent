#!/usr/bin/env python3
"""SPA-aware static server — all non-file routes fallback to index.html."""
import http.server
import os
import sys

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def translate_path(self, path):
        """Override: if the requested path is not a real file, serve index.html."""
        # Strip query and fragment
        clean = path.split('?')[0].split('#')[0]
        filepath = os.path.join(DIST, clean.lstrip('/'))
        if os.path.isfile(filepath):
            return filepath
        return os.path.join(DIST, 'index.html')

    def log_message(self, fmt, *args):
        # Quieter logging
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5200
    server = http.server.HTTPServer(('0.0.0.0', port), SPAHandler)
    print(f'Web Console SPA server on http://0.0.0.0:{port}')
    server.serve_forever()
