
# 🎬 vconcat.py 日本語README

## 概要

`vconcat.py` は、指定ディレクトリ内の動画ファイルを結合し、以下の処理を施して1本の動画を出力する Python スクリプトです。

- 解像度の統一（--strict）
- 透かし画像の重ね合わせ（--inpose）
- トレーラー動画の追加（--trailer）
- BGMの追加（--audio）
- 音声の正規化（--normalize）
- 最後に3秒のフェードアウト（--fadeout）
- 元動画の削除・整理（--remove）

## 必要環境

- Python 3.7以降
- `ffmpeg`（コマンドラインツール）
- `ffprobe`（`ffmpeg` に含まれる）

macOSでのインストール例：

```bash
brew install ffmpeg
```

## 実行例

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

## 引数一覧

| オプション            | 説明 |
|---------------------|------|
| `--src-dir`         | 入力動画が格納されているディレクトリ（デフォルト：カレント） |
| `--target`          | 対象とする拡張子（例：mp4） |
| `--dest`            | 出力ファイルのパス |
| `--strict`          | 出力動画の解像度（例："1920x1080"） |
| `--inpose`          | オーバーレイ画像（ロゴ等）を重ねる PNG など |
| `--trailer`         | 結合後に追加するトレーラー動画 |
| `--audio`           | BGM用音声ファイル（MP3など） |
| `--audio-mode`      | 音声の合成方法（`mix` または `force`、デフォルトは `mix`） |
| `--normalize`       | 音声を正規化（ラウドネスを調整） |
| `--shortest`        | 音声と動画の長さを短い方に揃える |
| `--fadeout`         | 最後の3秒間にフェードアウト効果を追加 |
| `--remove`          | 処理済みファイルをゴミ箱に移動して整理 |

## 出力ディレクトリ構成（例）

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

## 注意事項

- `--inpose` を指定する際は、動画と同解像度または透過PNG画像を推奨します。
- BGMが長すぎる場合、`--shortest` を指定することで動画の長さに自動調整されます。
- `--fadeout` は動画が3秒以上の長さである場合のみ適用されます。

## ライセンスと著作権

本スクリプトはプロトタイピング・教育用途向けです。商用利用される場合は、素材（音声・画像・動画）の権利にご留意ください。
