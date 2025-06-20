
# 🎬 vconcat.py README (English)

## Overview

`vconcat.py` is a Python script to concatenate video files from a directory into one final output video with the following processing steps:

- Resolution normalization (`--strict`)
- Overlay watermark image (`--inpose`)
- Append trailer video (`--trailer`)
- Add background audio (`--audio`)
- Audio normalization (`--normalize`)
- Final 3-second audio fadeout (`--fadeout`)
- Cleanup of source videos (`--remove`)

## Requirements

- Python 3.7+
- `ffmpeg` (command-line tool)
- `ffprobe` (included in `ffmpeg`)

Install on macOS:

```bash
brew install ffmpeg
```

## Example Execution

```bash
python3 vconcat.py \
  --src-dir="./vconcat" \
  --target="mp4" \
  --dest="/Users/aki/Documents/AICU/final.mp4" \
  --strict="1920x1080" \
  --inpose="niji.png" \
  --trailer="AICU-logoanimation-1920x1080.mp4" \
  --audio="KawaiiTutorialDreams.mp3" \
  --shortest \
  --fadeout
```

## Option List

| Option              | Description |
|---------------------|-------------|
| `--src-dir`         | Source directory containing video files (default: current directory) |
| `--target`          | Target video extension (e.g., mp4) |
| `--dest`            | Output file path |
| `--strict`          | Output resolution (e.g., "1920x1080") |
| `--inpose`          | Overlay image such as logo (PNG) |
| `--trailer`         | Trailer video to append after merging |
| `--audio`           | Background music audio file (e.g., MP3) |
| `--audio-mode`      | Audio combination mode (`mix` or `force`, default is `mix`) |
| `--normalize`       | Normalize audio loudness |
| `--shortest`        | Cut to the shortest stream (audio or video) |
| `--fadeout`         | Add 3-second audio fadeout at the end |
| `--remove`          | Move processed input files to trash |

## Output Structure (Example)

```
temp_concat_work/
├── work_000.mp4
├── overlaid_000.mp4
├── trailer_reencoded.mp4
├── concat_list.txt
├── output_temp.mp4
├── output_audio.mp4
├── output_final.mp4
```

## Notes

- When using `--inpose`, it’s recommended to use PNG with alpha or match resolution.
- If the background audio is longer than the video, `--shortest` can be used to auto-trim it.
- `--fadeout` applies only when the video length exceeds 3 seconds.

## License

This script is for prototyping and educational use. Please ensure that any media assets used (audio, image, video) are legally cleared for your usage.
