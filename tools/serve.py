"""Serve docs/ for local checking. Not part of the site or the pipeline.

This deliberately imitates two things GitHub Pages does, because without them
local browsing is much slower than the real site and you end up optimizing the
wrong thing:

  gzip      Pages compresses text responses. The profile files are JSON, which
            compresses about six to one, so serving them raw locally made the
            site feel heavy when the published one is not.
  no cache  Pages sets a short cache; here nothing is cached at all, so an edit
            is never masked by a stale copy in the browser.
"""

import gzip
import http.server
import io
import os
import socketserver
from pathlib import Path

PORT = 8787
ROOT = Path(__file__).resolve().parent.parent / "docs"
COMPRESS = {".json", ".html", ".css", ".js", ".svg", ".txt", ".csv"}
MIN_COMPRESS_BYTES = 1024

os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet: the interesting output is the checks, not the requests

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def send_head(self):
        path = Path(self.translate_path(self.path))
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")

        if (not accepts_gzip or not path.is_file()
                or path.suffix.lower() not in COMPRESS
                or path.stat().st_size < MIN_COMPRESS_BYTES):
            return super().send_head()

        body = gzip.compress(path.read_bytes(), 6)
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return io.BytesIO(body)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"serving docs/ at http://127.0.0.1:{PORT} (gzip on, no caching)",
              flush=True)
        httpd.serve_forever()
