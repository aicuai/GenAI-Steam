#!/bin/sh
# 音 → 映像 → 合体。本番は 1920x1080 / ブラー10回（数分〜十数分）
set -e
cd "$(dirname "$0")"
python3 make_audio.py
python3 render.py --out video.mp4 "$@"
ffmpeg -y -loglevel error -i video.mp4 -i audio.wav -c:v copy -c:a aac -b:a 256k -shortest final.mp4
echo "done -> final.mp4"
