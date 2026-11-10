#!/usr/bin/env python3
"""web_serve.py: serve web/ for Web Serial (no bridge), without browser caching.

    tools/web_serve.py              (http://localhost:8080; the page then uses Web Serial)
    tools/web_serve.py --port 8081

python3 -m http.server lets Chrome keep app.js and the other modules: after a change the page runs the old code until a hard
reload. Every response here says Cache-Control: no-store, as tools/web_bridge.py does. Listens on 127.0.0.1 only.
"""
import argparse
import functools
import http.server
import os

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    a = ap.parse_args()
    handler = functools.partial(NoCache, directory=os.path.realpath(WEB))
    with http.server.ThreadingHTTPServer(("127.0.0.1", a.port), handler) as srv:
        print(f"http://localhost:{a.port}  (Web Serial; serving {os.path.realpath(WEB)})", flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
