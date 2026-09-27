<!-- YouTube アップロード用メタデータ（下書き）。アップロードは人間が行う。
     動画: motion/final.mp4（1920×1080・60fps・ブラー10回・AAC 256k）
     公開設定の提案: 記事の公開までは「限定公開」、記事公開と同時に「公開」 -->

## タイトル（100字以内）

Opus5.5にモーショングラフィックスを作らせてみた｜素材ゼロ・コードだけの15秒（128BPM × 32拍）

## 説明

Claude Opus 5.5 が HTML と Python のコードだけで作った、15秒・900コマのモーショングラフィックスと音楽です。画像も音源も使っていません。

映像と音楽は、同じ「拍の表」から別々に計算しています。128BPM × 32拍 = 15秒。4拍目で MOVE が入り、28拍目で爆発し、その直前の4分の1拍（約0.12秒）は音も映像も完全に0です。

▼ 解説記事（しくみ・コード・ファクトチェック）
https://aicu.ai/media/demo/Opus5.5-motion-graphics/

▼ ソースコード
記事ページからダウンロードできます（index.html / render.py / make_audio.py / build.sh）

▼ 制作
- 映像：Canvas 2D（ヘッドレス Chromium で1コマずつ描画）
- 音楽：NumPy で波形を計算（キック・スネア・ハット・スーパーソー・サイドチェイン）
- 書き出し：Playwright + ffmpeg
- コード：Claude Opus 5.5 ／ 企画・検証・文：白井暁彦（AICU）

#Claude #Opus5.5 #モーショングラフィックス #CreativeCoding #AICU

## タグ

Claude, Claude Opus 5.5, Anthropic, モーショングラフィックス, motion graphics, creative coding, プロシージャル音楽, Canvas, ffmpeg, AICU

## その他の設定
- カテゴリ：科学と技術
- 言語：日本語
- 子ども向けではない
- 【要確認】サムネイル：public/media/demo/Opus5.5-motion-graphics/assets/og.jpg を流用するか、claude.jpg（最終コマ）にするか
- 【要確認】記事公開前にアップロードする場合、説明文の記事 URL はまだ 404
