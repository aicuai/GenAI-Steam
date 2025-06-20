#!/usr/bin/env python3
import os
import sys
import argparse
import shutil
import subprocess
from pathlib import Path

def print_readme():
    print("""\
🎬 concat_videos.py - Video Concatenation Tool with ffmpeg

Usage:
  python3 concat_videos.py [options]

Options:
  --src-dir=DIR          Source directory (default: current directory)
  --target=EXT           File extension to process (default: mp4)
  --dest=FILE            Output path (default: ./concat.mp4)
  --strict=WxH           Enforce resolution (e.g., 1920x1080)
  --inpose=FILE          Overlay transparent PNG image
  --trailer=FILE         Append trailer video at the end
  --audio=FILE           External audio file to mix or force replace
  --audio-mode=MODE      "mix" (default) or "force"
  --remove               Move processed inputs to trash after done
  --normalize            Apply audio loudness normalization (-23 LUFS)

Dependencies:
  - ffmpeg must be installed.
    👉 macOS: brew install ffmpeg
""")
    sys.exit(0)

def check_ffmpeg():
    if subprocess.run(["which", "ffmpeg"], stdout=subprocess.DEVNULL).returncode != 0:
        print("❌ ffmpeg is not installed.")
        print("👉 Install it with:\n   brew install ffmpeg")
        sys.exit(1)

def run_ffmpeg(cmd):
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def resize_video(src, dst, resolution):
    w, h = resolution.split("x")
    vf = f"scale=w={w}:h={h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"
    run_ffmpeg(["ffmpeg", "-y", "-i", str(src), "-vf", vf, "-c:a", "copy", str(dst)])


def overlay_image(src, dst, overlay_path):
    run_ffmpeg([
        "ffmpeg", "-y", "-i", str(src), "-i", str(overlay_path),
        "-filter_complex", "overlay=0:0", "-c:a", "copy", str(dst)
    ])

def apply_audio(src, dst, audio_path, mode):
    if mode == "mix" and not has_audio_stream(src):
        print("⚠️  No audio stream detected in video. Switching to --audio-mode=force.")
        mode = "force"

    if mode == "force":
        run_ffmpeg([
            "ffmpeg", "-y", "-i", str(src), "-i", str(audio_path),
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-shortest", str(dst)
        ])
    else:  # mix
        run_ffmpeg([
            "ffmpeg", "-y", "-i", str(src), "-i", str(audio_path),
            "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest", "-c:v", "copy",
            "-shortest", str(dst)
        ])




def normalize_audio(src, dst):
    result = subprocess.run([
        "ffmpeg", "-y", "-i", str(src),
        "-filter:a", "loudnorm=I=-23:LRA=7:TP=-2",
        "-c:v", "copy", str(dst)
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    if not dst.exists():
        print("❌ Failed to normalize audio. ffmpeg output:")
        print(result.stdout)
        sys.exit(1)



def move_to_trash(path):
    trash_dir = Path.home() / ".Trash"
    shutil.move(str(path), trash_dir / path.name)

def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--src-dir", type=str, default=".")
    parser.add_argument("--target", type=str, default="mp4")
    parser.add_argument("--dest", type=str, default="concat.mp4")
    parser.add_argument("--strict", type=str)
    parser.add_argument("--inpose", type=str)
    parser.add_argument("--trailer", type=str)
    parser.add_argument("--audio", type=str)
    parser.add_argument("--audio-mode", type=str, choices=["mix", "force"], default="mix")
    parser.add_argument("--remove", action="store_true")
    parser.add_argument("--normalize", action="store_true")

    args = parser.parse_args()

    if len(sys.argv) == 1:
        print_readme()

    check_ffmpeg()

    src_dir = Path(args.src_dir).resolve()
    ext = args.target.lower()
    output = Path(args.dest).resolve()
    temp_dir = Path("temp_concat_work").resolve()
    temp_dir.mkdir(exist_ok=True)
    combined_dir = temp_dir / "combined"
    combined_dir.mkdir(exist_ok=True)

    overlay = Path(args.inpose).resolve() if args.inpose else None
    trailer = Path(args.trailer).resolve() if args.trailer else None
    audio = Path(args.audio).resolve() if args.audio else None
    resolution = args.strict
    audio_mode = args.audio_mode

    files = sorted([f for f in src_dir.glob(f"*.{ext}") if f.is_file()])
    if trailer and trailer in files:
        files.remove(trailer)

    if not files:
        print("❌ No video files found.")
        sys.exit(1)

    print("📜 Processing files:")
    processed_files = []
    for i, f in enumerate(files):
        print(f" - {f.name}")
        tmp = f
        work_file = temp_dir / f"work_{i:03d}.{ext}"

        if resolution:
            resize_video(tmp, work_file, resolution)
            tmp = work_file
        if overlay:
            overlaid = temp_dir / f"overlaid_{i:03d}.{ext}"
            overlay_image(tmp, overlaid, overlay)
            tmp = overlaid
        processed_files.append(tmp)

    if trailer:
        print(f"📎 Appending trailer: {trailer.name}")
        processed_files.append(trailer)

    concat_list = temp_dir / "concat_list.txt"
    with open(concat_list, "w") as f:
        for vid in processed_files:
            f.write(f"file '{vid}'\n")

    intermediate_output = temp_dir / "output_temp.mp4"
    print("▶️ Concatenating videos...")
    run_ffmpeg(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(intermediate_output)])

    audio_output = temp_dir / "output_audio.mp4"
    if audio:
        print(f"🎵 Adding audio: {audio.name} (mode: {audio_mode})")
        apply_audio(intermediate_output, audio_output, audio, audio_mode)
    else:
        shutil.copy(intermediate_output, audio_output)

    normalized_output = temp_dir / "output_normalized.mp4"
    if args.normalize:
        print("📶 Normalizing audio...")
        normalize_audio(audio_output, normalized_output)
    else:
        shutil.copy(audio_output, normalized_output)

    shutil.copy(normalized_output, output)
    print(f"\n✅ Done! Output saved to: {output}")

    if args.remove:
        for f in files:
            shutil.move(str(f), combined_dir / f.name)
        if trailer and trailer.exists():
            shutil.move(str(trailer), combined_dir / trailer.name)
        move_to_trash(combined_dir)
        print(f"🗑️ Cleaned up and moved to trash: {combined_dir}")

if __name__ == "__main__":
    main()
