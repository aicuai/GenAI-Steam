"""Opus 5.5 の作例（motion/index.html を拍だけ差し替えた serve/opus.html）を PPSG-ElenaBloom の区間で書き出す。"""
import argparse, base64, functools, http.server, json, pathlib, subprocess, sys, threading
ap = argparse.ArgumentParser(); ap.add_argument("--scale", type=float, default=0.5); ap.add_argument("--sub", type=int, default=4)
ap.add_argument("--out", default="opus.mp4"); a = ap.parse_args()
HERE = pathlib.Path(__file__).parent; SERVE = HERE / "serve"
g = json.loads((HERE / "grid_172.json").read_text()); start = g["offset"] + 96 * 60 / g["bpm"]
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(SERVE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome"); pg = br.new_page()
    pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/opus.html?render=1&scale={a.scale}&sub={a.sub}")
    pg.wait_for_function("window.ready === true", timeout=60000)
    total = pg.evaluate("window.FRAMES")
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "30", "-i", "-",
        "-ss", f"{start:.4f}", "-t", f"{total/30:.4f}", "-i", str(SERVE / "song.mp3"), "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-movflags", "+faststart", str(HERE / a.out)], stdin=subprocess.PIPE)
    for f in range(total):
        ff.stdin.write(base64.b64decode(pg.evaluate(f"renderFrame({f})").split(",", 1)[1]))
        if f % 60 == 0: print(f"\rframe {f}/{total}", end="", file=sys.stderr, flush=True)
    br.close()
ff.stdin.close(); ff.wait(); print(f"\ndone -> {a.out} (song {start:.3f}s〜)", file=sys.stderr)
