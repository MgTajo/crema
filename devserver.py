#!/usr/bin/env python3
"""Static dev server for Crema.

`python3 -m http.server` sends no Cache-Control header, so browsers apply
heuristic caching to the ES modules under src/. During development that
means editing a file, reloading, and debugging the *previous* version —
silently, with no error to hint at it.

This serves the same tree with `no-store` on everything.

    python3 devserver.py [port]     # default $PORT, else 4599

Production is unaffected: sw.js owns caching there.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 4599))
    print(f"Crema dev server → http://localhost:{port}  (no-store)")
    try:
        ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        pass
