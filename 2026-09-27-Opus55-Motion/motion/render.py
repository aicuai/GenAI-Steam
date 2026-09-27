"""index.html を画面なし Chrome で1コマずつ描かせ、ffmpeg に流して MP4 にする。

  pip install playwright && playwright install chromium
  python render.py                       # 1920x1080 / ブラー10回（本番）
  python render.py --scale 0.5 --sub 3   # 960x540 の試し書き出し
"""
import argparse, base64, pathlib, subprocess, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="video.mp4")
ap.add_argument("--scale", type=float, default=1.0)
ap.add_argument("--sub", type=int, default=10, help="モーションブラーのサンプル数")
ap.add_argument("--start", type=int, default=0)
ap.add_argument("--end", type=int, default=None)
a = ap.parse_args()

html = pathlib.Path(__file__).with_name("index.html").resolve().as_uri()
w, h = round(1920 * a.scale), round(1080 * a.scale)

ff = subprocess.Popen(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "60", "-i", "-",
     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium",
     "-movflags", "+faststart", a.out],
    stdin=subprocess.PIPE)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": w, "height": h})
    page.goto(f"{html}?render=1&scale={a.scale}&sub={a.sub}")
    page.wait_for_function("window.ready === true", timeout=60000)
    total = page.evaluate("window.FRAMES")
    end = a.end if a.end is not None else total
    t0 = time.time()
    for f in range(a.start, end):
        url = page.evaluate(f"renderFrame({f})")
        ff.stdin.write(base64.b64decode(url.split(",", 1)[1]))
        if f % 30 == 0:
            el = time.time() - t0
            print(f"\rframe {f}/{end}  {el:5.0f}s", end="", file=sys.stderr, flush=True)
    browser.close()

ff.stdin.close(); ff.wait()
print(f"\ndone -> {a.out}", file=sys.stderr)
