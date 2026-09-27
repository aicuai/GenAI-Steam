"""motion/ の制作物を公開フォルダへ反映する（冪等。何度実行してもよい）。

  python3 scripts/sync.py

- motion/index.html, motion/audio.wav      -> demo/（記事内ライブデモ）
- motion の4ファイル                        -> source/opus55-motion-source.zip
- motion/final.mp4 があれば                 -> assets/opus55-motion.mp4（25MiB 超なら停止）
"""
import pathlib, shutil, sys, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
MOTION = ROOT / "motion"
PAGE = ROOT / "public/media/demo/Opus5.5-motion-graphics"
LIMIT = 25 * 1024 * 1024  # Cloudflare Workers 静的アセットの1ファイル上限

(PAGE / "demo").mkdir(parents=True, exist_ok=True)
(PAGE / "source").mkdir(parents=True, exist_ok=True)

shutil.copy2(MOTION / "index.html", PAGE / "demo/index.html")
if (MOTION / "audio.wav").exists():
    shutil.copy2(MOTION / "audio.wav", PAGE / "demo/audio.wav")
else:
    print("! motion/audio.wav がありません。motion/ で python3 make_audio.py を実行してください")

with zipfile.ZipFile(PAGE / "source/opus55-motion-source.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for name in ("index.html", "render.py", "make_audio.py", "build.sh"):
        z.write(MOTION / name, f"opus55-motion/{name}")

final = MOTION / "final.mp4"
if final.exists():
    size = final.stat().st_size
    if size > LIMIT:
        sys.exit(f"! final.mp4 が {size/1048576:.1f}MiB あります。25MiB 以下に再エンコードしてください"
                 "（例: ffmpeg -i final.mp4 -c:v libx264 -crf 22 -preset slow -c:a aac -b:a 192k -movflags +faststart web.mp4）")
    shutil.copy2(final, PAGE / "assets/opus55-motion.mp4")
    print(f"✓ assets/opus55-motion.mp4 を本番版に差し替え（{size/1048576:.1f}MiB）")

for p in sorted(PAGE.rglob("*")):
    if p.is_file() and p.stat().st_size > LIMIT:
        sys.exit(f"! 25MiB 超のファイル: {p.relative_to(ROOT)}")
print("✓ sync 完了")
