"""記事ページの E2E 確認とスクリーンショット撮影（読み取りのみ・配信なし）。

public/ をローカルで配信し、ヘッドレス Chromium で次を確かめて撮影する。
  - 記事が表示される（デスクトップ 1280px / スマートフォン 390px）
  - 390px で横スクロールが出ない
  - 動画が読み込まれ、再生で時刻が進む
  - 拍タイムラインの場面ボタンで、その拍へシークする
  - ライブデモが起動し、キャンバスが描かれる
  - ソース zip がダウンロードできる

  pip install playwright && playwright install chromium
  python3 scripts/e2e.py            # → e2e/screenshots/ と e2e/report.json
"""
import functools, http.server, json, pathlib, re, sys, threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OUT = ROOT / "e2e" / "screenshots"
PATH = "/media/demo/Opus5.5-motion-graphics/"
BEAT = 60 / 128


class Quiet(http.server.SimpleHTTPRequestHandler):
    """Range 要求に答える（動画のシークに必要。Cloudflare の静的アセットと同じふるまい）"""

    def log_message(self, *a):
        pass

    def send_head(self):
        m = re.match(r"bytes=(\d+)-(\d*)$", self.headers.get("Range", ""))
        path = pathlib.Path(self.translate_path(self.path))
        if not m or not path.is_file():
            return super().send_head()
        size = path.stat().st_size
        start, end = int(m[1]), min(int(m[2]) if m[2] else size - 1, size - 1)
        f = open(path, "rb"); f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.range_left = end - start + 1
        return f

    def copyfile(self, src, dst):
        n = getattr(self, "range_left", None)
        if n is None:
            return super().copyfile(src, dst)
        try:
            while n > 0:
                buf = src.read(min(65536, n))
                if not buf:
                    break
                dst.write(buf); n -= len(buf)
        except (BrokenPipeError, ConnectionResetError):
            pass  # ブラウザがシークで読み込みを打ち切った


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(PUBLIC)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}{PATH}"

from playwright.sync_api import sync_playwright

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'✓' if ok else '✗'} {name}  {detail}", file=sys.stderr)


def slug(text):
    return re.sub(r"[^0-9A-Za-z一-龥ぁ-んァ-ヶー]+", "-", text).strip("-")[:40] or "section"


def shoot_sections(page, outdir):
    """各 h2 を画面上端に合わせて、ビューポートを撮る"""
    heads = page.locator("h2")
    for i in range(heads.count()):
        h = heads.nth(i)
        h.evaluate("el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16)")
        page.wait_for_timeout(150)
        page.screenshot(path=str(outdir / f"{i + 1:02d}-{slug(h.inner_text())}.png"))


with sync_playwright() as p:
    br = p.chromium.launch()
    errors = []

    for label, vp, mobile in [("desktop", {"width": 1280, "height": 800}, False),
                              ("mobile", {"width": 390, "height": 844}, True)]:
        outdir = OUT / label
        outdir.mkdir(parents=True, exist_ok=True)
        ctx = br.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, is_mobile=mobile,
                             has_touch=mobile, reduced_motion="reduce")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"{label}: {e}"))
        resp = page.goto(URL, wait_until="networkidle")
        check(f"{label}: 記事が 200 で返る", resp and resp.status == 200, str(resp and resp.status))
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(outdir / "00-hero.png"))
        page.screenshot(path=str(outdir / "full.png"), full_page=True)
        sw = page.evaluate("document.documentElement.scrollWidth")
        check(f"{label}: 横スクロールが出ない", sw <= vp["width"], f"scrollWidth={sw}")
        shoot_sections(page, outdir)
        ctx.close()

    # 動画・拍タイムライン・ライブデモ（デスクトップで確認）
    ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(URL, wait_until="networkidle")
    page.evaluate("() => { const v = document.getElementById('film'); v.muted = true; v.preload = 'auto'; v.load(); }")
    page.wait_for_function("document.getElementById('film').readyState >= 2", timeout=30000)
    dur = page.evaluate("document.getElementById('film').duration")
    check("動画が読み込まれる", dur and dur > 14, f"duration={dur:.2f}s")

    page.evaluate("document.getElementById('film').play()")
    page.wait_for_timeout(1200)
    ct = page.evaluate("document.getElementById('film').currentTime")
    check("再生で時刻が進む", ct > 0.3, f"currentTime={ct:.2f}s")

    btn = page.locator("#scenes button", has_text="CLAUDE")
    btn.click()
    page.wait_for_function("document.getElementById('film').seeking === false")
    page.evaluate("document.getElementById('film').pause()")
    ct = page.evaluate("document.getElementById('film').currentTime")
    check("拍タイムライン: CLAUDE で28拍目へ", abs(ct - 28 * BEAT) < 0.6, f"currentTime={ct:.2f}s（期待 {28 * BEAT:.2f}s）")
    page.locator(".stage").screenshot(path=str(OUT / "desktop" / "video-beat28.png"))

    page.locator("#demoStart").scroll_into_view_if_needed()
    page.locator("#demoStart").click()
    frame = page.frame_locator("#demo iframe")
    frame.locator("canvas#c").wait_for(timeout=30000)
    page.wait_for_timeout(2500)
    drawn = page.frame_locator("#demo iframe").locator("canvas#c").evaluate(
        "c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;"
        " let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n; }")
    check("ライブデモが描画する", drawn > 50, f"明るい画素サンプル={drawn}")
    page.locator("#demo").screenshot(path=str(OUT / "desktop" / "live-demo.png"))

    href = page.locator("a.dl").get_attribute("href")
    r = page.request.get(URL + href)
    check("ソース zip がダウンロードできる", r.status == 200 and len(r.body()) > 1000, f"{r.status} {len(r.body())} bytes")
    ctx.close()
    br.close()

check("ページ内の JavaScript エラーなし", not errors, "; ".join(errors[:3]))
(ROOT / "e2e" / "report.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
failed = [r for r in results if not r["ok"]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed → e2e/screenshots/", file=sys.stderr)
sys.exit(1 if failed else 0)
