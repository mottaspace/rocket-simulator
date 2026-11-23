"""로컬 테스트용 정적 서버 (캐시 끔). 사용법: python scripts/dev_server.py [포트]"""
import http.server
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
handler = partial(NoCache, directory=str(ROOT))
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
