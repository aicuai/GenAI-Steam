# AGENTS.md — aicu-media-demo-opus55-motion

このリポジトリで作業する AI エージェント（Claude Code ほか）と人間のための作業規約です。
作業を始める前に最後まで読んでください。

## このリポジトリは何か

AICU media の記事「ついに"リズム感"を手に入れた Opus5.5にモーショングラフィックスを作らせてみた！」と、
記事で紹介している作例（コードだけで作る15秒のモーショングラフィックスと音楽）を、1つのリポジトリで管理しています。

- 公開 URL（正）: `https://aicu.ai/media/demo/Opus5.5-motion-graphics/`（末尾スラッシュあり）
- 配信: Cloudflare Workers の静的アセット（`wrangler.jsonc`）
- 窓の杜への寄稿: `article/madonomori.md`（入稿用の別稿）

## ディレクトリ構成

```
motion/                     作例の制作ソース（正本）
  index.html                映像。1コマずつ決定論的に描くキャンバス
  render.py                 ヘッドレス Chromium → ffmpeg で MP4 書き出し
  make_audio.py             音楽を波形計算で生成 → audio.wav
  build.sh                  音 → 映像 → 合体（final.mp4）
public/                     配信ルート。ここのパスがそのまま URL のパスになる
  _headers                  キャッシュ等のヘッダ
  media/demo/Opus5.5-motion-graphics/
    index.html              記事ページ（Web 版本文の正本）
    404.html
    assets/                 動画・スチル・OG 画像
    demo/                   記事内ライブデモ（motion/ から sync で生成）
    source/                 ダウンロード用 zip（motion/ から sync で生成）
article/madonomori.md       窓の杜 入稿稿
scripts/sync.py             motion/ → public/ へ反映（冪等）
scripts/check.py            公開前チェック（読み取りのみ）
```

## 正本と生成物

| 内容 | 正本（ここを直す） | 生成物（手で直さない） |
|---|---|---|
| 作例コード | `motion/*` | `public/.../demo/*`, `public/.../source/*.zip` |
| Web 記事本文 | `public/.../index.html` | — |
| 窓の杜 本文 | `article/madonomori.md` | — |
| 記事の動画 | `motion/final.mp4`（Git 管理外） | `public/.../assets/opus55-motion.mp4` |

`motion/` を変更したら必ず `npm run sync` を実行してください。`demo/` と `source/` を直接編集してはいけません。

## コマンド

```sh
# 作例の書き出し（Python 3, ffmpeg, playwright が必要）
cd motion && ./build.sh                    # 1920x1080・ブラー10回 → final.mp4
cd motion && ./build.sh --scale 0.5 --sub 3  # 試し書き出し

# サイト
npm install
npm run sync            # motion/ → public/ へ反映
npm run check           # リンク切れ・25MiB 超・canonical・TODO 残りを検査
npm run dev             # sync → check → wrangler dev（ローカル確認）
npm run build:dry-run   # デプロイ内容の検証のみ（配信はしない）
npm run e2e             # 記事の E2E 確認とスクリーンショット → e2e/screenshots/（playwright が必要）
```

エージェントが自分の判断で実行してよいのは、上のうち配信を伴わないもの（build.sh、sync、check、dev、build:dry-run、e2e）だけです。

## 人間の確認が必要な操作

AICU の原則は「壊せないものだけを自動化する」です。次の操作は、エージェントが提案・コマンドの用意まではしてよいですが、**実行は人間が内容を確認してから**行います。

- `wrangler deploy`（workers.dev 含む、あらゆる配信）
- `wrangler.jsonc` の `routes` の追加・変更・コメント解除
- DNS、ゾーン設定、他の Worker / Pages プロジェクトの変更
- `aicu.ai` 配下のほかのパスに影響しうる変更（ルートのパターンを広げるなど）
- `vercel domains add` などドメイン操作全般（過去に21サブドメインが停止した事故あり）

### ルート設定の前に人間が確かめること

1. `aicu.ai` が Cloudflare でプロキシされているゾーンか。されていない場合、Worker ルートは効かない
2. パターン `aicu.ai/media/demo/Opus5.5-motion-graphics*` が、既存の `aicu.ai/media/*` の配信元（別 Worker、Pages、外部オリジン）と衝突しないか。Worker ルートはより具体的なパターンが優先される
3. デプロイ後、次の3つがすべて期待どおりか
   - `/media/demo/Opus5.5-motion-graphics` → 末尾スラッシュ付きへリダイレクト
   - `/media/demo/Opus5.5-motion-graphics/` → 記事が表示される
   - `/media/` やトップページなど、ほかのパスが今までどおり表示される

## 実装上の約束

- **URL のパスは変えない。** `Opus5.5-motion-graphics` の大文字・ドットも含めて固定です。記事はパス内に `.` を含むため、末尾スラッシュなしでも表示されることを必ず確認してください
- **記事内のリンクは相対パス**（`assets/…`、`demo/`、`source/…`）で書きます。canonical・og:url・og:image・JSON-LD だけは絶対 URL です
- 末尾スラッシュ前提の相対パスなので、`html_handling: auto-trailing-slash` を外さないでください
- **1ファイル25MiB 以下。** Cloudflare Workers 静的アセットの上限です。本番動画は `crf 20〜23` 程度で再エンコードし、`-movflags +faststart` を付けます（`sync.py` が超過を検出して止まります）
- `assets/` は1日キャッシュです。動画を差し替えたら公開後にキャッシュの反映を確認してください
- 記事ページは外部 JS ライブラリなし。フォントは Google Fonts（Dela Gothic One / Zen Kaku Gothic New / Anton / JetBrains Mono）のみ
- ライブデモは重いので、クリックするまで iframe を読み込まない作りを維持します
- `motion/index.html` は決定論的であること。乱数は必ずシード付きの `rng()` を使い、`Math.random()` や現在時刻を描画に使わない（書き出すたびに絵が変わるのを防ぐため）
- 映像と音のタイミングは**拍番号でだけ**書く。秒やコマ番号を直書きしない。映像側 `scene()` と音側 `make_audio.py` の拍番号は常に対応させる

## 編集方針（記事）

- 事実だけを書く。この実験で確認したこと（拍の設計、コードの中身、書き出し時間の実測、見つけて直したバグ）に限り、Claude Opus 5.5 の性能一般について検証していない主張（ベンチマーク、「〜できるようになった」という一般化）を足さない
- 見出し・タイトルは「Opus5.5」表記（記事タイトルとして確定済み）。本文ではモデル名を「Claude Opus 5.5」と書く
- 数字は根拠と一緒に。128BPM × 32拍 = 15秒、60fps × 15秒 = 900コマ、無音は4分の1拍 = 約0.12秒。本文を変えたら計算も見直す
- 書き出し時間の実測値は、測った環境（Claude の作業環境、CPU 1コア、960×540、ブラー3回、約110秒）とセットで書く
- 「天才」などの誇張表現は使わない
- Web 版（`index.html`）と窓の杜版（`madonomori.md`）は文体・構成が異なる別稿。事実関係（数字・手順・ファイル名）を変えたら両方に反映する

## 公開前チェックリスト

- [ ] `motion/final.mp4` を本番設定で書き出し、`npm run sync` で `assets/opus55-motion.mp4` を差し替えた（現在はリポジトリ同梱の 960×540 確認版）
- [ ] `npm run check` が通る
- [ ] `npm run dev` で、記事・動画の再生・拍タイムラインのシーク・ライブデモ起動・zip ダウンロードを確認した
- [ ] スマートフォン幅（390px）で横スクロールが出ない
- [ ] OG 画像が SNS のカード検証ツールで表示される（公開後）
- [ ] 窓の杜版の数字・手順が Web 版と一致している
- [ ] ルート設定とデプロイを人間が実施した（上の「ルート設定の前に人間が確かめること」）
