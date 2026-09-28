# PPSG-ElenaBloom で試した書き出し

楽曲：AiCuty「Pico Pico! Shooting Game（Elena Bloom ver.）」作詞・作曲 Nao Verde、歌 Elena Bloom（170.16秒、172BPM、1拍目 0.296秒）。AICU の許諾のもとで公開しています。
手順と測定結果は `../../../article/full-edition.md` 第4部。

| ファイル | 内容 |
|---|---|
| `jizura_full_172bpm_seed7.mp4` | JIZURA・曲全体・172BPM 指定・シード7（1920×1080/30fps、GitHub 用に crf27 で再圧縮） |
| `jizura_full_172bpm_seed20260928.mp4` | 同・シード20260928 |
| `jizura_172bpm_seed7_22s.mp4` | JIZURA・96〜160拍（33.8〜56.1秒）・172BPM 指定・シード7（960×540） |
| `jizura_172bpm_seed20260928_22s.mp4` | 同・シード20260928 |
| `jizura_auto170.7bpm_seed7_22s.mp4` | 同区間・JIZURA の自動推定（170.7BPM）のまま |
| `opus_172bpm_22s.mp4` | Opus 5.5 の作例（motion/index.html）を拍だけ差し替えて同区間にかぶせたもの |
| `compare_22s.mp4` | 2×2 比較（作例／JIZURA 自動推定／JIZURA 172BPM 指定／波形） |

22秒版は、作例の32拍構成のちょうど2周分（64拍）を「Pico Pico! (Shooting Game!)」の繰り返し区間に合わせて比べるために切り出したもの。
