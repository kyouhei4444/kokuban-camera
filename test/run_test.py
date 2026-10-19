"""通しテスト
ローカルの http サーバーで index.html に test/flow.js を差し込んで配り、
ヘッドレス Chrome（偽カメラ）で開く。ページから POST された結果・写真を受け取り、
写真の Exif と ZIP の中身を Python 側でも確かめる。

使い方:  python test/run_test.py
"""
import http.server, json, os, subprocess, sys, threading, time, zipfile, io, hashlib, tempfile

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), 'kokuban_test')
os.makedirs(OUT, exist_ok=True)
PORT = 8765
done = threading.Event()
result = {}

CATCH = ('<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push((e.message||"?")+" @"+'
         '((e.filename||"").split("/").pop())+":"+(e.lineno||""));});window.addEventListener("unhandledrejection",'
         'function(e){window.__errs.push("promise: "+(e.reason&&e.reason.message||e.reason));});'
         'localStorage.clear();localStorage.setItem("kc.settings",JSON.stringify({autoDownload:false,sound:false}));'
         'indexedDB.deleteDatabase("kokuban-camera");</script>')


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=APP, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith('/__test'):
            html = open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
            flow = open(os.path.join(APP, 'test', 'flow.js'), encoding='utf-8').read()
            html = html.replace('<body>', '<body>\n' + CATCH, 1)
            html = html.replace('</body>', '<script>' + flow + '</script>\n</body>', 1)
            b = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        super().do_GET()

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        if self.path == '/done':
            result['log'] = json.loads(body.decode('utf-8'))
            done.set()
        else:
            name = self.path.split('/')[-1]
            with open(os.path.join(OUT, name), 'wb') as f:
                f.write(body)
        self.send_response(204)
        self.end_headers()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    chrome = next(p for p in [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'] if os.path.exists(p))
    prof = tempfile.mkdtemp(prefix='kc_prof_')
    proc = subprocess.Popen([chrome, '--headless=new', '--no-first-run', '--disable-gpu',
                             '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                             '--autoplay-policy=no-user-gesture-required', '--window-size=420,900',
                             '--user-data-dir=' + prof, '--remote-debugging-port=0',
                             f'http://127.0.0.1:{PORT}/__test'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    got = done.wait(90)
    proc.kill()
    srv.shutdown()
    if not got:
        print('タイムアウト（結果が返ってこなかった）')
        sys.exit(1)

    fails = 0
    for r in result['log']:
        mark = 'OK ' if r['ok'] else 'NG '
        fails += 0 if r['ok'] else 1
        print(mark, r['name'], ('  ' + r['info']) if r['info'] else '')

    # --- Python 側の確認 ---
    from PIL import Image
    from PIL.ExifTags import TAGS
    def chk(name, cond, info=''):
        nonlocal fails
        fails += 0 if cond else 1
        print('OK ' if cond else 'NG ', name, info)

    jp = os.path.join(OUT, 'photo.jpg')
    raw = open(jp, 'rb').read()
    im = Image.open(jp)
    chk('PIL: 1280x960', im.size == (1280, 960), im.size)
    ex = im.getexif()
    sub = ex.get_ifd(0x8769)
    chk('Exif DateTimeOriginal', bool(sub.get(0x9003)), sub.get(0x9003))
    chk('Exif PixelX/Y', (sub.get(0xA002), sub.get(0xA003)) == (1280, 960), (sub.get(0xA002), sub.get(0xA003)))
    chk('Exif Orientation=1', ex.get(0x0112) == 1)
    chk('Exif Software', str(ex.get(0x0131, '')).startswith('KokubanCamera'), ex.get(0x0131))
    meta = json.load(open(os.path.join(OUT, 'photo.json'), encoding='utf-8'))
    chk('SHA-256 一致', hashlib.sha256(raw).hexdigest() == meta['sha256'])
    chk('APP1 が SOI 直後', raw[2:4] == b'\xff\xe1')
    im2 = Image.open(os.path.join(OUT, 'photo2.jpg'))
    chk('PIL: 2枚目 1536x2048', im2.size == (1536, 2048), im2.size)
    im3 = Image.open(os.path.join(OUT, 'photo_rot90.jpg'))
    chk('PIL: 横に倒した写真 960x1280', im3.size == (960, 1280), im3.size)
    z = zipfile.ZipFile(os.path.join(OUT, 'test.zip'))
    chk('ZIP 検査', z.testzip() is None, z.namelist())
    chk('ZIP 日本語名', any('撮影台帳' in n for n in z.namelist()))
    print('出力:', OUT)
    print('失敗', fails, '件')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
