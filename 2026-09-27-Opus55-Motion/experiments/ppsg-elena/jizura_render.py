"""JIZURA を曲 PPSG-ElenaBloom で動かす実験。
拍推定（J.analyzeAudio）→ 構成（J.plan, LRC の時刻を使用）→ 指定区間を1コマずつ描いて ffmpeg へ。

  python jizura_render.py --start 33 --end 57 --seed 7 --out jizura.mp4
"""
import argparse, base64, functools, http.server, json, pathlib, subprocess, sys, threading

ap = argparse.ArgumentParser()
ap.add_argument("--start", type=float, default=33.0)
ap.add_argument("--end", type=float, default=57.0)
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--scale", type=float, default=0.5)
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--out", default="jizura.mp4")
ap.add_argument("--bpm", type=float, default=0, help="指定すると拍推定の代わりに BPM+offset の格子を使う")
ap.add_argument("--offset", type=float, default=0)
a = ap.parse_args()

HERE = pathlib.Path(__file__).parent
SERVE = HERE / "serve"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
handler = functools.partial(Quiet, directory=str(SERVE))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"

from playwright.sync_api import sync_playwright

SETUP = """
async ([seed, fps, bpm, offset]) => {
  const blob = await (await fetch('song.mp3')).blob();
  const A = await J.analyzeAudio(new File([blob], 'song.mp3'));
  const lrc = await (await fetch('song.lrc')).text();
  const p = Object.assign(J.defaultProject(), { lyrics: lrc, seed, extra: true, fps, aspect: '16:9' });
  const beats = bpm > 0 ? J.beatGrid(bpm, offset, A.duration) : A.beats;
  const plan = J.plan(p, { beats, duration: A.duration, energy: A.energy, energyRate: A.energyRate });
  await J.ensureFonts(lrc + '0123456789:/', J.fontsOfPlan(plan));
  window.__plan = plan; window.__r = new J.Renderer();
  window.__cv = document.createElement('canvas');
  return { bpm: A.bpm, usedBpm: bpm || A.bpm, nBeats: beats.length, firstBeats: beats.slice(0, 6), beats,
           cuts: plan.cuts.map(c => [c.start, c.end]), W: plan.W, H: plan.H, style: plan.style && plan.style.key };
}
"""
FRAME = """
([t, scale]) => { const cv = window.__cv, pl = window.__plan;
  cv.width = Math.round(pl.W * scale); cv.height = Math.round(pl.H * scale);
  window.__r.frame(cv.getContext('2d'), pl, t, { scale }); return cv.toDataURL('image/png'); }
"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/jizura.html")
    pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1500)
    info = pg.evaluate(SETUP, [a.seed, a.fps, a.bpm, a.offset])
    (HERE / (a.out.rsplit(".", 1)[0] + "_analysis.json")).write_text(json.dumps(info, ensure_ascii=False))
    print(f"JIZURA bpm={info['bpm']} beats={info['nBeats']} first={info['firstBeats']} cuts={len(info['cuts'])}", file=sys.stderr)
    w, h = round(info["W"] * a.scale), round(info["H"] * a.scale)
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(a.fps), "-i", "-",
                           "-ss", str(a.start), "-t", str(a.end - a.start), "-i", str(SERVE / "song.mp3"),
                           "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(HERE / a.out)],
                          stdin=subprocess.PIPE)
    n = int(round((a.end - a.start) * a.fps))
    for f in range(n):
        url = pg.evaluate(FRAME, [a.start + f / a.fps, a.scale])
        ff.stdin.write(base64.b64decode(url.split(",", 1)[1]))
        if f % 60 == 0:
            print(f"\rframe {f}/{n}", end="", file=sys.stderr, flush=True)
    br.close()
ff.stdin.close(); ff.wait()
print(f"\ndone -> {a.out}  errors={errs[:3]}", file=sys.stderr)
