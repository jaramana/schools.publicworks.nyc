"""Serve docs/ for local checking. Not part of the site or the pipeline."""
import http.server
import os
import socketserver
from pathlib import Path

PORT = 8787
os.chdir(Path(__file__).resolve().parent.parent / "docs")


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet: the interesting output is the checks, not the requests

    def end_headers(self):
        # Without this the browser keeps serving the previous script from its
        # own cache, and an edit appears to have had no effect.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving docs/ at http://127.0.0.1:{PORT}", flush=True)
    httpd.serve_forever()
