#!/usr/bin/env python3
"""Headless Chrome runner: serves the site locally, opens tests/browser.html with a fake microphone,
waits for the results POST, prints them. Usage: python3 tests/browser-run.py [path-to-chrome]"""
import http.server, json, os, subprocess, sys, tempfile, threading
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
result = {}
done = threading.Event()
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(s, *a): pass
    def do_POST(s):
        n = int(s.headers.get('Content-Length', 0)); result.update(json.loads(s.rfile.read(n)))
        s.send_response(204); s.end_headers(); done.set()
H.extensions_map['.js'] = 'text/javascript'; H.extensions_map['.mjs'] = 'text/javascript'
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
chrome = sys.argv[1] if len(sys.argv) > 1 else 'google-chrome'
url = f'http://127.0.0.1:{srv.server_address[1]}/tests/browser.html'
prof = tempfile.mkdtemp(prefix='kjv-test-chrome-')
p = subprocess.Popen([chrome, '--headless=new', '--no-sandbox', '--disable-gpu', f'--user-data-dir={prof}',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0', url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ok = done.wait(120)
p.terminate(); srv.shutdown()
if not ok: print('TIMEOUT: no result from browser'); sys.exit(2)
print(result.get('log', ''))
sys.exit(1 if result.get('fail') else 0)
