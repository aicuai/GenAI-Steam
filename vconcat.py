import os
import sys
import argparse
import shutil
import subprocess
from pathlib import Path

def get_duration(path):
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(path)
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        return float(result.stdout.strip())
    except:
        return 0.0

def has_audio_stream(video_path: Path) -> bool:
    result = subprocess.run([
        "ffprobe", "-i", str(video_path),
        "-show_streams", "-select_streams", "a", "-loglevel", "error"
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return bool(result.stdout.strip())

def run_ffmpeg(cmd):
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def resize_video(src, dst, resolution):
    w, h = resolution.split("x")
    vf = f"scale=w={w}:h={h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"
    run_ffmpeg(["ffmpeg", "-y", "-i", str(src), "-vf", vf, "-r", "30", "-c:a", "copy", str(dst)])

def overlay_image(src, dst, overlay_path):
    run_ffmpeg([
        "ffmpeg", "-y", "-i", str(src), "-i", str(overlay_path),
        "-filter_complex", "overlay=0:0", "-c:a", "copy", str(dst)
    ])

def apply_audio(src, dst, audio_path, mode, shortest=False):
    if mode == "mix" and not has_audio_stream(src):
        print("⚠️  No audio stream in video. Switching to force mode.")
        mode = "force"
    fade_filter = "afade=t=out:st=999:d=2"
    if mode == "force":
        cmd = [
            "ffmpeg", "-y", "-i", str(src), "-i", str(audio_path),
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy"
        ]
        if shortest:
            cmd += ["-shortest"]
        cmd += [str(dst)]
    else:
        cmd = [
            "ffmpeg", "-y", "-i", str(src), "-i", str(audio_path),
            "-filter_complex", f"[1:a]{fade_filter}[fade];[0:a][fade]amix=inputs=2:duration=shortest[outa]",
            "-map", "0:v", "-map", "[outa]", "-c:v", "copy"
        ]
        if shortest:
            cmd += ["-shortest"]
        cmd += [str(dst)]
    run_ffmpeg(cmd)

def normalize_audio(src, dst):
    result = subprocess.run([
        "ffmpeg", "-y", "-i", str(src),
        "-filter:a", "loudnorm=I=-23:LRA=7:TP=-2",
        "-c:v", "copy", str(dst)
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if not dst.exists():
        print("❌ Audio normalize failed.")
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
    parser.add_argument("--shortest", action="store_true")
    parser.add_argument("--fadeout", action="store_true")
    args = parser.parse_args()

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
        dur = get_duration(f)
        print(f" - {f.name} ({dur:.1f} sec)")
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
        trailer_tmp = temp_dir / "trailer_reencoded.mp4"
        resize_video(trailer, trailer_tmp, resolution or "1920x1080")
        processed_files.append(trailer_tmp)

    concat_list = temp_dir / "concat_list.txt"
    with open(concat_list, "w") as f:
        for vid in processed_files:
            f.write(f"file '{vid}'\n")

    intermediate_output = temp_dir / "output_temp.mp4"
    print("▶️ Concatenating videos (re-encoded)...")
    run_ffmpeg([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
        str(intermediate_output)
    ])

    audio_output = temp_dir / "output_audio.mp4"
    if audio:
        print(f"🎵 Adding audio: {audio.name} (mode: {audio_mode})")
        apply_audio(intermediate_output, audio_output, audio, audio_mode, args.shortest)
    else:
        shutil.copy(intermediate_output, audio_output)

    normalized_output = temp_dir / "output_normalized.mp4"
    if args.normalize:
        print("📶 Normalizing audio...")
        normalize_audio(audio_output, normalized_output)
    else:
        shutil.copy(audio_output, normalized_output)


    # Final fade-out if requested
    final_output = temp_dir / "output_final.mp4"
    if args.fadeout:
        print("🎧 Applying final audio fade-out...")
        run_ffmpeg([
            "ffmpeg", "-y", "-i", str(normalized_output),
            "-af", "afade=t=out:d=3", "-c:v", "copy", str(final_output)
        ])
    else:
        shutil.copy(normalized_output, final_output)

    shutil.copy(final_output, output)
    print(f"✅ Done! Output saved to: {output}")

    if args.remove:
        for f in files:
            shutil.move(str(f), combined_dir / f.name)
        if trailer and trailer.exists():
            shutil.move(str(trailer), combined_dir / trailer.name)
        move_to_trash(combined_dir)
        print(f"🗑️ Cleaned up and moved to trash: {combined_dir}")

if __name__ == "__main__":
    main()
