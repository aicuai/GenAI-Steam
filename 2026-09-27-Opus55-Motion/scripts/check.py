"""公開前チェック（読み取りのみ。何も書き換えない）。

  python3 scripts/check.py

- 記事と 404 の相対リンク・画像・動画がすべて実在するか
- 25MiB を超えるファイルがないか
- canonical / og:url が正しい公開 URL を指しているか
- 記事内に TODO / XXX が残っていないか
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "public/media/demo/Opus5.5-motion-graphics"
URL = "https://aicu.ai/media/demo/Opus5.5-motion-graphics/"
errors = []

html = (PAGE / "index.html").read_text(encoding="utf-8")
for ref in re.findall(r'(?:src|href|poster)="([^"#]+)"', html) + re.findall(r"url\(([^)]+)\)", html) \
        + re.findall(r"f\.src='([^'?]+)", html):
    if ref.startswith(("http", "mailto:", "/")):
        continue
    target = (PAGE / ref).resolve()
    if target.is_dir():
        target = target / "index.html"
    if not target.exists():
        errors.append(f"リンク切れ: {ref}")

for tag in ('rel="canonical" href="', 'property="og:url" content="'):
    if f'{tag}{URL}"' not in html:
        errors.append(f"{tag.split('=')[1]} が {URL} になっていない")
if re.search(r"TODO|XXX", html):
    errors.append("本文に TODO / XXX が残っている")

for p in PAGE.rglob("*"):
    if p.is_file() and p.stat().st_size > 25 * 1024 * 1024:
        errors.append(f"25MiB 超: {p.relative_to(ROOT)}")

if errors:
    print("\n".join("✗ " + e for e in errors)); sys.exit(1)
print("✓ check OK")
