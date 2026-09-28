<!--
full edition（長尺版・書き足し用の正本）
- Web 版 public/media/demo/Opus5.5-motion-graphics/index.html、窓の杜版 article/madonomori.md とは別稿。
  ここに書き足し、確定した事実を短い版へ降ろしていく。
- 【要確認】【TODO】は公開前に解消する。数字は根拠（測定方法・環境）と一緒に書く。
- 実験の再現スクリプト: experiments/ppsg-elena/（素材と書き出しは gitignore）
-->

# ついに"リズム感"を手に入れた Opus5.5にモーショングラフィックスを作らせてみた！【full edition】

文・白井暁彦（AICU）／2026年9月27日 初稿

## はじめに：この長い版で確かめること

Claude Opus 5.5 に、素材ファイルなしで15秒のモーショングラフィックスと音楽をコードだけで作らせたところ、映像と音がぴたりと噛み合った作品ができた。短い版の記事では、そのしくみをコードを引用しながら紹介した。

この full edition では、見た目の気持ちよさの一歩先を確かめる。

1. 「リズム感」という言葉は本当か。モデルは音を聴いているのか
2. どこかのテンプレートやエフェクト集を流用していないか。部品の出どころはどこか
3. 動きを決める数式は、線形なのか非線形なのか
4. 手持ちの曲でも同じことができるのか。実際に AiCuty の楽曲「Pico Pico! Shooting Game（Elena Bloom ver.）」で試す
5. 同じ時期に公開された文字PVツール JIZURA とはどう違うのか
6. Remotion で Claude Code に動画を作らせてきた流れの中で、今回なにが変わったのか
7. 「キレのいい動き」は、理論的には何から生まれているのか

---

## 第1部 作例：15秒・900コマを「拍の表」で書く

（短い版の本文と同じ内容。拍の表、イージング、変形・奥行き・粒子、仕上げ、音楽、書き出し、自分で直したバグ。Web 版 index.html の該当節を正本とし、ここでは要点だけ再掲する）

- テンポは 128BPM。1拍 0.46875秒、32拍（8小節）でちょうど15秒、60fps で900コマ
- 映像は時刻を拍に直した値 `b = t / BEAT` で場面を分岐し、音楽も同じ拍番号で書く。だから構造上ずれない
- 4拍目で MOVE、8拍目から図形の変形、16拍目でグラフエディタ、20拍目でトンネル、24拍目で立方体、27.75拍目から4分の1拍の完全な無音と暗転、28拍目で爆発して粒子が CLAUDE に集まる
- 書き出しは、ヘッドレス Chromium に「f コマ目を描いて」と900回頼み、PNG を ffmpeg に流す
- 最初の書き出しでは、爆発前のグリッチが28拍目以降も最大のまま残るバグがあった。Opus 5.5 はコマを並べた一覧画像を自分で見て気づき、条件を1行足して直した

---

## 第2部 ファクトチェック

### 2-1 モデルは音を聴いていない

`make_audio.py` は音を読み込むプログラムではなく、音を**書き出す**プログラムだ。映像と音楽は、同じ拍番号の表から別々に計算されている。同期しているのは聴いて合わせたからではなく、同じ表から両方を作っているからである。

Opus 5.5 が作業中に確かめたのも、コマを並べた**画像**だけで、音声は確かめていない。記事タイトルの「リズム感」は、音を聴き取る能力ではなく、「時間を拍で数えて設計する発想」を指している。

### 2-2 拍で書く発想は、どこから来たか

最初に渡した説明文（別セッションで Opus 5.5 自身に書かせた制作解説）には、すでに「拍」「イージング」「粒子」「音作り」の考え方が含まれていた。今回の実験だけでは、Opus 5.5 が自発的に拍で設計したとは言えない。ほかのモデルに同じ依頼をした比較もしていない。タイトルの「ついに」は、筆者がこの1年 Claude で動画を作ってきた実感であって、検証した差ではない（第6部で詳しく書く）。

### 2-3 テンプレートの流用か：部品の出どころ

Remotion などの動画フレームワークは使っていない。依存は Playwright・NumPy・ffmpeg だけである。一方で、細部には定番の部品がそのまま入っている。原典のコードと突き合わせた結果を表にする。

| 部品 | 出どころ（推定を含む） | 一致の程度 |
|---|---|---|
| イージング expo・back・bounce・inOutCubic | Robert Penner のイージング式 http://robertpenner.com/easing/ 。書き方は easings.net のソース https://github.com/ai/easings.net/blob/master/src/easings/easingsFunctions.ts | 定数と変数名（`c1 = 1.70158`, `c3 = c1 + 1`, `7.5625`, `2.75`）まで一致。同じ式でも tween.js https://github.com/tweenjs/tween.js/blob/main/src/Easing.ts は `s`・`amount` と変数名が違うので、easings.net の系統と判断できる |
| シード付き乱数 `rng()` | mulberry32（Tommy Ettinger、2017年、パブリックドメイン）https://gist.github.com/tommyettinger/46a874533244883189143505d203312c 。JavaScript 版は bryc のまとめ https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32 | 定数 `0x6D2B79F5` とシフト量 15・7・14 まで一字一句一致 |
| 曲線の名前 expo.out など | GSAP の命名 https://gsap.com/docs/v3/Eases/ | 名前だけ |
| モーションブラー（1コマを複数回描いて平均、シャッター角） | beesandbombs のモーションブラーのテンプレート https://beesandbombs.tumblr.com/post/65346867831/motion-blur-for-processing 、解説 https://bleuje.com/tutorial6/ | 考え方と「シャッター角」の役割が一致 |
| 文字の画素から粒子を作る | Mamboleoo のチュートリアル https://www.mamboleoo.be/articles/how-to-convert-an-image-into-particles | 「不透明度が128を超える画素を拾う」判定まで一致 |
| 形の変形（周長を等分した点どうしの補間） | flubber https://github.com/veltman/flubber 、GSAP MorphSVG https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/ | 同じ問題のもっとも素朴な解き方。考え方だけ |
| 赤青のずれ・フィルム粒子・周辺減光 | three.js の RGBShift・GlitchPass・Film・Vignette https://github.com/mrdoob/three.js/tree/dev/examples/jsm/shaders | 考え方だけ。Canvas 2D で書き直している |
| 遠近法のトンネル | デモシーンの定番。Lode's tunnel https://lodev.org/cgtutor/tunnel.html | 考え方だけ |
| キック・スネア・ハット | Sound On Sound「Synth Secrets」https://www.soundonsound.com/techniques/synthesizing-drums-bass-drum ・ https://www.soundonsound.com/techniques/synthesizing-drums-snare-drum 、Web Audio でのドラム合成 https://dev.opera.com/articles/drum-sounds-webaudio/ | 考え方だけ |
| スーパーソー | Roland JP-8000。Adam Szabo の解析 https://adamszabo.com/internet/adam_szabo_how_to_emulate_the_super_saw.pdf | 「7本」という本数だけ一致。ずらし幅は独自 |
| 1極ローパス `a = 1 - exp(-2πfc/SR)` | EarLevel Engineering https://www.earlevel.com/main/2012/12/15/a-one-pole-filter/ | 教科書どおりの式 |

作例に固有の行（`prog()`、`pulse()`、`glitchAmount()`、サイドチェインの式 `np.exp(-since / 0.09)` など）を GitHub のコード検索にかけたが、一致はなかった（2026年9月27日）。比較として mulberry32 の定数を検索すると、他のリポジトリが普通にヒットする。GitHub のコード検索は公開リポジトリの既定ブランチしか対象にしないので、「元の作品が存在しない」ことの証明にはならない。

After Effects 側の近縁として、Penner の式を AE に移した aescripts の Ease and Wizz、音楽の拍を検出してマーカーを打つ BeatEdit、バウンスとオーバーシュートの式で知られる Dan Ebberts の解説 http://www.motionscript.com/articles/bounce-and-overshoot.html がある。【要確認】aescripts のページはボットを遮断しており、Ease and Wizz と BeatEdit の中身はまだ確認できていない。

結論：1本のテンプレートやプラグインを流用したものではない。何十年も使われてきた定番の部品を、「拍の表」という骨組みに組み立てたものである。

### 2-4 数式は線形だけではない

| 式の形 | コード中の例 | 効き方 |
|---|---|---|
| 線形 | `lerp(a, b, t)`、拍区間を0〜1に直す `prog()` | すべての動きの「進み具合」の土台 |
| 逆数 | 立方体 `900 / (900 + z + 600)`、トンネル `f / (z * 60)`、ブラーの逐次平均 `1 / (i + 1)` | 遠いほど小さい。奥行きは逆数でできている |
| 指数 | `expoOut`、拍の脈動 `exp(-frac(b) * 6)`、キックの音程 `44 + 150 * exp(-t * 32)`、サイドチェイン `1 - 0.75 * exp(-since / 0.09)`、爆発の閃光 `exp(-(b - 28) * 6)` | 一瞬で立ち上がり、すっと減る。打楽器と動きの減衰が同じ形。Inigo Quilez の小さな関数集 https://iquilezles.org/articles/functions/ の impulse と同じ発想 |
| 多項式 | `backOut`（3次）、`inOutCubic`、上昇ノイズ `u ** 2`、グリッチの強まり `prog(...) ** 2` | 行き過ぎて戻る、じわじわ加速する |
| 区分的な放物線 | `bounceOut`（4区間） | 跳ねるたびに低く、間隔も短くなる |
| 飽和 | `tanh(mix * 1.3)`、`clamp()` | 音を柔らかく潰す、値をはみ出させない |
| 周波数応答 | `1 / sqrt(1 + (f / fc) ** 4)` | 2次のバターワース特性 https://en.wikipedia.org/wiki/Butterworth_filter の振幅 |
| べき（対数スケール） | `440 * 2 ** ((n - 69) / 12)`（MIDI の標準式 https://en.wikipedia.org/wiki/MIDI_tuning_standard ）、`10 ** (-1 / 20)` | 耳が対数で聞くことに合わせる |
| 三角関数 | 回転、揺れ | 回転と周期運動 |

---

## 第3部 シード付き乱数は「決定論」か

そのとおりで、決定論的である。`rng(seed)` が返すのは、本物の乱数ではなく、**種（シード）が同じなら毎回まったく同じ並びになる数列**（擬似乱数）だ。mulberry32 は32ビットの状態を掛け算とシフトでかき混ぜるだけの式で、同じシードからは何度実行しても同じ数が同じ順に出る。

作例では、この性質を3か所で使っている。

- 5,000個の粒子の飛び方（`rng(7)`）
- フィルム粒子の画像（`rng(3)`）と、コマごとの位置（`rng(frame * 977 + 1)`）
- グリッチで画面を横に切る位置（`rng(frame + 11)`）

最後の2つは、シードに**コマ番号**を混ぜている。コマごとに違う模様になりつつ、同じコマは何度描いても同じ模様になる。だから、900コマを頭から順に描いても、途中の1コマだけを描き直しても、結果が変わらない。

`Math.random()` を使うと、書き出すたびに絵が変わる。並列で書き出すと、隣り合うコマの粒子が別々の乱数から作られてちらつく。AGENTS.md が「乱数は必ずシード付きの `rng()` を使う」と定めているのはこのためだ。

これは今回の作例に固有の工夫ではない。Remotion も同じことを求めている。Claude Code チームの Thariq 氏が公開している Remotion 用の CLAUDE.md（後述）には、次のように書かれている。

> Remotion needs all of the React code to be deterministic. Therefore, it is forbidden to use the Math.random() API. If randomness is requested, the "random()" function from "remotion" should be used and a static seed should be passed to it.
> — https://gist.github.com/ThariqS/3d446e7c7aa9eb94f468194deb73028f

Remotion の `random('my-seed')` https://www.remotion.dev/docs/random も、文字列をシードにする擬似乱数である。

### 3-1 実際に再現できるか：音声はビット単位で一致した

2026年9月27日、筆者の MacBook で `make_audio.py` を実行し直し、Claude の作業環境で作られてリポジトリに入っていた `audio.wav` と比べた。48kHz・ステレオ・720,000サンプル、波形データ 2,880,000バイトが**ビット単位で完全に一致**した。NumPy の乱数も `np.random.default_rng(1)` とシードを固定しているので、ハットやスネアの雑音まで同じになる。

ファイルの大きさだけは違った。リポジトリ版の末尾には 5,766バイトの C2PA（コンテンツの来歴を証明する規格）のマニフェストが付いていて、`com.anthropic.claude.provided` という動作と「Claude provided this file at the request of a user and may have created or modified the file contents.」という説明、作成者として Claude が記録されていた。Claude の作業環境から受け取ったファイルには、この来歴情報が付く。手元で作り直したファイルには付かない。【要確認】c2patool で署名を検証し、マニフェストの全体を確認する。

決定論的なコードと来歴の記録がそろっていれば、「このファイルは Claude が作った」「同じコードから誰でも同じものが作れる」の両方を確かめられる。

### 3-2 シードを表現の探索に使う

JIZURA のシードは、同じ決定論を**表現の探索**に使っている。シードを変えると構成がまるごと変わり、同じシードに戻せば同じ構成が再現できる（`seed: 20260922` が既定値）。「偶然の見た目」と「やり直しがきくこと」を両立させるのが、シード付き乱数の役割だ。

---

## 第4部 実験：手持ちの曲で試す

モデルが音を聴いていないなら、逆に言えば、**拍の時刻さえ分かればどんな曲にも同じ設計が使える**はずだ。AiCuty の楽曲「Pico Pico! Shooting Game（Elena Bloom ver.）」（作詞・作曲 Nao Verde、歌 Elena Bloom、170.16秒）で確かめた。素材は MP3、歌詞の LRC、字幕の ASS。

### 4-1 まず BPM が分からない

同じ MP3 を、4つの方法で測った。

| 方法 | 結果 | 備考 |
|---|---|---|
| aubio `aubiotrack`（拍の時刻の中央値間隔） | 175.3 BPM | 拍435個 |
| aubio `aubio tempo` | 166.0 BPM | 同じ aubio でもコマンドで違う |
| JIZURA `J.analyzeAudio()` | 170.7 BPM | 拍484個 |
| 自己相関・50Hz・仮説なし（筆者の検算） | 85.9 BPM | 半分のテンポを選んでしまう |
| 自己相関・400Hz・1〜128拍の長いラグで検算 | **172.00 BPM** | 1・8・32・64・128拍のどのラグでも 172.0 に揃い、相関も最大 |
| LRC の行間隔から逆算（1行＝8拍と仮定） | 約173.6 BPM | 人手の時刻なので粗い |

この曲の本当のテンポは **172 BPM** と判断した。1拍 0.34884秒、1拍目は 0.296秒。

外れ方には、それぞれ理由がある。

- **仮説なしだと半分を選ぶ**：拍の周期 τ で相関が強い曲は、2τ（半分のテンポ）でも同じくらい強い。どちらかを決めるには「人はこのくらいのテンポに感じやすい」という仮説が要る（4-3）。
- **JIZURA の 170.7 は刻みの限界**：JIZURA は曲を1秒50コマ（20ミリ秒刻み）で分析する。172BPM の1拍は 17.44コマで、整数のコマ数では 17（176.5BPM）か 18（166.7BPM）しか測れない。その間を放物線で補間した結果が 170.7 になっている。0.76% の誤差だ。
- **aubio の 175.3**：aubio の拍の時刻を直線で当てはめても残差が 89ミリ秒と大きく、拍の取り違えが混じっている。【要確認】aubio のパラメータ（窓長・ホップ）を変えて再測定する。

### 4-2 わずかな BPM の誤差が、何秒でずれになるか

JIZURA のように「1つのテンポで等間隔の拍を並べる」方式では、BPM の誤差が時間とともに積み上がる。

- JIZURA（170.7）：1拍あたり 2.7ミリ秒遅れ、**約46秒で1拍ぶん**ずれる
- aubio（175.3）：1拍あたり 6.5ミリ秒早まり、**約18秒で1拍ぶん**ずれる

JIZURA で書き出した構成の、カットの切れ目が本当の拍（172BPM）からどれだけ離れているかを数えた。

| 条件 | 全152カットのずれ（中央値） | 50ミリ秒以内 | 比較区間 33.8〜56.1秒のずれ（中央値） |
|---|---|---|---|
| JIZURA 自動推定（170.7BPM） | 68ミリ秒 | 43% | 116ミリ秒 |
| JIZURA に 172BPM・1拍目0.296秒を指定 | 0ミリ秒 | 67% | 24ミリ秒 |

JIZURA は BPM と1拍目を手で入れる欄を持っているので、正しい値を入れれば直る。自動推定の弱点を、人が補える設計になっている。

### 4-3 JIZURA のテンポ推定は「仮説つき」

JIZURA のテンポ推定の中心部分（© 2026 hakoniwa、MIT License。https://github.com/852wa/JIZURA/blob/main/src/10_audio.js ）。

```js
// tempo via autocorrelation (70..180 BPM)
for (let lag = minLag; lag <= maxLag; lag++) {
  let s = 0; for (let f = lag; f < n; f++) s += onset[f] * onset[f - lag];
  const bpm = 60 * rate / lag;
  const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.7, 2));
  s *= w; scores[lag] = s;
  if (s > best) { best = s; bestLag = lag; }
}
```

`w` の行は、Dan Ellis「Beat Tracking by Dynamic Programming」（2007）https://www.ee.columbia.edu/~dpwe/pubs/Ellis07-beattrack.pdf の式(6)と同じ形である。論文は、人が曲に合わせて手を叩くテンポが 120BPM 前後に偏るという実験結果をもとに、自己相関に対数時間軸のガウス分布の重みをかける。JIZURA は中心を 125BPM、幅を 0.7オクターブにしている。librosa の `beat_track` の `start_bpm=120` https://librosa.org/doc/0.10.2/generated/librosa.beat.beat_track.html も同じ系譜だ。

この曲では、172BPM と半分の 86BPM がほぼ同じ重み（125BPM からそれぞれ約0.46オクターブ上と約0.54オクターブ下）になる。わずかに近い 172 側が選ばれて、正しい答えになった。

- **作例は BPM の決めうち**：`BPM = 128` と書き、曲のほうを合わせて作る。推定も仮説もない
- **JIZURA は仮説つきの推定**：曲は与えられたもので、そのテンポを「125BPM 前後だろう」という事前の仮説のもとで推定する

### 4-4 作例をこの曲にかぶせる

Opus 5.5 の `motion/index.html` を、次の4か所だけ書き換えた（`experiments/ppsg-elena/serve/opus.html`）。

- `BPM = 172`、`BEATS = 64`（32拍の構成を2周）
- 場面の分岐を `b = (t / BEAT) % 32` に
- HUD の拍番号を曲の拍番号（96〜）に
- 音声を曲の MP3 に

「Pico Pico! (Shooting Game!)」の繰り返しは、172BPM の格子でほぼ96拍目から8拍おきに並ぶ（LRC の行頭を拍番号に直すと 96.96, 105.45, 113.10, 120.76, 128.47 …）。そこで96〜160拍目（33.78〜56.11秒）を書き出した。960×540、ブラー4回、670コマで35秒（筆者の MacBook）。

結果：拍に対する場面転換やキックの脈動は、きちんと曲の拍に乗る。一方で、作例はこの曲のことを何も知らないので、次の3つがおかしくなる。

- 曲の途中なのに、32拍ごとにイントロ（点が並ぶ場面）からやり直す
- 元の曲に合わせた「27.75拍目の無音と暗転」が、音が鳴り続けている中で暗転だけ起きる
- 歌詞を1文字も使わない

「拍に合う」ことと「曲に合う」ことは別物だ、ということがよく分かる。作例の設計は、音楽の構造（どこがサビで、どこでブレイクするか）まで拍の表に書き込んで初めて完成する。

### 4-5 JIZURA で同じ区間を書き出す

JIZURA は `J.plan()`（構成）と `J.Renderer().frame(ctx, plan, t)`（任意の時刻の1コマ）を公開しているので、作例と同じ「時刻を指定して1コマずつ描く」方法でヘッドレス書き出しができた（`experiments/ppsg-elena/jizura_render.py`）。LRC をそのまま歌詞として渡すと、行ごとの時刻がそのまま使われる。

JIZURA は歌詞の行ごとにレイアウト・登場・退場・装飾を選ぶので、「Pico Pico!」「Shooting Game!」の文字が行ごとに違う演出で現れる。拍の検出が合っていれば（172BPM 指定）、文字の登場とカットが拍に乗る。自動推定のままだと、区間によっては半拍近く遅れる。

比較動画：`experiments/ppsg-elena/videos/compare_22s.mp4`（左上：作例、右上：JIZURA 自動推定、左下：JIZURA 172BPM 指定、右下：波形）。曲全体（170秒）を JIZURA で書き出したものも、シード違いで2本置いた（`jizura_full_172bpm_seed7.mp4`、`jizura_full_172bpm_seed20260928.mp4`）。同じ歌詞・同じ拍でも、シードが違えばレイアウト・書体・色・演出がまるごと入れ替わる。楽曲は AICU の許諾のもとで公開している。【TODO】記事に埋め込む。

### 4-6 拍の時刻の手に入れ方（まとめ）

| 曲の素性 | 拍の時刻の手に入れ方 | ずれの心配 |
|---|---|---|
| BPM が分かっている（打ち込み、クリック録音、ストック音源の表記） | BPM と1拍目の位置を書く。JIZURA の `beatGrid(bpm, offset, duration)` と同じ計算 | ほぼない。1拍目の位置合わせだけ |
| MIDI がある | テンポ情報から計算（pretty_midi の `get_beats()` https://github.com/craffel/pretty-midi 、@tonejs/midi https://github.com/Tonejs/Midi ） | ない。途中のテンポ変化にも対応 |
| 音声だけ | 推定（JIZURA、librosa、madmom https://github.com/CPJKU/madmom 、aubio https://aubio.org/ 、Essentia https://essentia.upf.edu/reference/std_RhythmExtractor2013.html 、web-audio-beat-detector https://github.com/chrisguttandin/web-audio-beat-detector 、bpm-detective https://github.com/tornqvist/bpm-detective ） | 推定しだい。今回のように倍・半分の取り違え、数%の誤差、それが積み上がるずれが起きる |

今回の実験からの教訓：**音声から推定したテンポは、長いラグ（32拍以上）の自己相関で検算するとよい**。1拍ぶんのラグでは分析の刻みに引きずられるが、32拍ぶんのラグなら刻みの誤差が32分の1になる。

---

## 第5部 Remotion と Claude Code：この1年

### 5-1 Thariq 氏の2025年7月のスレッド

Claude Code チームの Thariq 氏（@trq212）は、2025年7月23日、Claude Code で動画を作る方法を投稿した。当時のスレッドの要点。

> The UI videos are all powered by Remotion (http://remotion.dev) - a library for creating videos using React. And Claude Code is great at writing code for Remotion!
> （UI の動画はすべて Remotion で作っている。React で動画を作るライブラリだ。そして Claude Code は Remotion のコードを書くのがとてもうまい）

> Just take your UI library components, pop them into your remotion codebase and ask Claude Code to make compositions that use them.
> （手持ちの UI コンポーネントを Remotion のコードベースに入れて、それを使った構成を Claude Code に頼めばいい）

> Looking to make something more science or math related? Manim (https://manim.community) is another library that made by @3blue1brown which lets you write Python code that renders videos.
> （科学や数学寄りのものなら、3Blue1Brown が作った Manim もある。Python で動画を描ける）

このとき公開された CLAUDE.md https://gist.github.com/ThariqS/3d446e7c7aa9eb94f468194deb73028f （2025年7月22日作成、420行）は、Remotion の書き方を Claude に教えるための指示書である。`Composition`、`useCurrentFrame()`、`Sequence`、`interpolate()`、`spring()` の使い方に加え、「すべて決定論的に」「`Math.random()` 禁止」「アニメーションはフレーム番号から `interpolate()` か `spring()` で作る」が明記されている。Manim の発見者として @wenquai 氏にも謝辞がある。

### 5-2 それから1年後

2026年、Thariq 氏は自分の1年前の投稿を引用して、こう書いた（https://x.com/trq212/status/2103897226154328502 ）。

> Just about 1 year ago I posted one of the first posts about using Claude Code to make videos. Each of these actually took a long time to iterate with Claude and get right, pointing out details that were wrong, etc. Crazy how far things have come.
> （ちょうど1年前、Claude Code で動画を作る最初期の投稿をした。あれは実際には1本ごとに Claude と長い時間をかけて繰り返し、間違った細部を指摘して、ようやく仕上げたものだった。ここまで来たのは驚きだ）

【要確認】引用ツイートの投稿日と、引用元の投稿（2025年7月23日）の正確な URL。本文の訳は筆者。

「1本ごとに長い時間をかけて、間違った細部を指摘して」という1年前の実感と、今回の作例との差は大きい。今回は、一言の依頼に対して、Opus 5.5 が4本のファイルを書き、書き出し、一覧画像で自分の不具合を見つけて直してから動画を渡してきた。人間が細部を指摘する回数は0回だった【要確認：最初のセッションでの追加の指示の有無】。

### 5-3 AICU での Remotion の経験

AICU でも2026年3月、Remotion と Marp でリリックビデオを作るツール music-slide-maker https://github.com/aicuai/music-slide-maker を作った。PPSG123（Mina Azure）の曲で、aubio で拍を検出し（BPM 121）、小節単位で歌詞を配置した。記録には、短いスライドでフェードの区間が重なると Remotion の `interpolate()` が「inputRange は単調増加でなければならない」というエラーで落ちる不具合を直した話もある。

筆者の検証では、Remotion の書き出しは拍に対するタイミングをそこまで高い精度で扱えなかった。【TODO】検証の条件と数値（どの曲・何 fps・何ミリ秒ずれたか）をここに書く。

考えられる理由（仮説。未検証）：

1. **コマ単位でしか時刻を持たない**：`useCurrentFrame()` は整数。30fps なら 33ミリ秒刻みで、172BPM の1拍（10.47コマ）は整数のコマに乗らない。拍の頭は最大17ミリ秒ずれた位置に丸められる
2. **音は別経路**：`<Audio>` は映像とは別に最後に合成される。映像側は音を知らないので、拍の時刻は人か別の解析が与える必要がある
3. **フレームを使わない動きが混ざる**：CSS のトランジションや `spring()` の物理的な収束時間は、拍とは無関係に決まる

作例は3つとも回避している。時刻を実数の秒と拍で持ち、モーションブラーのためにコマの**内側**の時刻（`(i + 0.5) / SUB` ぶんずらした時刻）でも描く。128BPM・60fps では1拍が 28.125コマで整数にならないが、1コマの中を10回描いて平均するので、「28拍目の爆発がコマの途中で起きる」ことまで絵に反映される。

---

## 第6部 なぜ「キレ」が出るのか：理論的な整理

筆者はこの1年、Claude に動画を作らせるたびに、Opus 5.5 でモーショングラフィックスの操作性と表現力がはっきり上がったと感じている。Blender を操作させた例でも同じ印象がある【TODO：Blender の例のリンクと内容】。何が効いているのかを、理論として整理してみる。以下は、コードと実験から言えることと、仮説を分けて書く。

### 6-1 ビジョンは「検品」には効くが、「キレ」の源ではない

作例の制作で、Opus 5.5 はコマの一覧画像を見てバグを見つけた。筆者とのこのやりとりでも、Claude はスクリーンショットを撮って表示を確かめている。モーショングラフィックスの制作がビジョン（画像の理解）に強く依存しているのは確かだ。

ただし、一覧画像から分かるのは**空間**の誤り（文字が読めない、色がずれたまま、はみ出している）である。**時間**の気持ちよさ（入りの速さ、止まる瞬間、拍との一致）は、静止画を並べても見えにくい。作例のタイミングが正しいのは、見て直したからではなく、拍の表から構造的に作ったからだ。キレの源は、ビジョンではなく**時間を式で書く設計**のほうにある、というのが本稿の見立てである。

### 6-2 キレは「初速」と「止まり方」で数値にできる

イージングの形は、数値で比べられる。

- `expoOut(t) = 1 - 2^(-10t)` の、動き出しの速度は `10 ln 2 ≈ 6.93`。同じ時間で等速に動く場合の約7倍の速さで飛び出し、残りの時間をかけて止まる。「スッと入ってピタッと止まる」の正体はこの非対称だ
- `backOut` の定数 `1.70158` は、最大で**ちょうど10%行き過ぎる**ように選ばれた値である（行き過ぎが最大になるのは全体の約58%の時点で、そのときの値が 1.100）
- `bounceOut` は放物線4つで、跳ねるたびに高さも間隔も縮む。Dan Ebberts が解説するとおり、減衰する正弦波ではこの「間隔が詰まっていく」感じは出ない

アニメーションの12原則 https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation の「スローイン・スローアウト」「タイミング」「誇張」を、式の定数として持っているわけだ。

### 6-3 キレは「拍に対して早すぎも遅すぎもしない」こと

映像の出来事と音のずれを、人はどのくらいで気づくのか。放送の音と映像の同期について、ITU-R 勧告 BT.1359 https://www.itu.int/rec/R-REC-BT.1359 は、音が映像より約45ミリ秒先行するか、約125ミリ秒遅れると気づかれ始める、としている【要確認：数値を原文で確認】。音が先に来るずれのほうに、人はずっと敏感だ。

第4部の実験に当てはめると、JIZURA の自動推定のまま比較区間で中央値116ミリ秒のずれは、検知の閾値をまたいでいる。172BPM を指定して24ミリ秒に縮めると、閾値の内側に入る。作例のように拍の表から作れば、ずれは原理的に0で、残るのはコマの丸め（60fps で最大8ミリ秒）だけになる。

### 6-4 キレは「溜め」と「解放」の構造でもある

作例の最後の4拍は、次のように組まれている。

- 26〜27.75拍：グリッチを2乗のカーブで強めていく（溜め）
- 27.75〜28拍：音も映像も完全に0（空白）
- 28拍：大きなキック、閃光 `exp(-6(b - 28))`、粒子の爆発 `expoOut`（解放）

音楽の「ブレイク → ドロップ」と、アニメーションの「予備動作（アンティシペーション）」を、同じ拍番号の上で重ねている。4-4 で見たとおり、この構造は曲を知らないと崩れる。キレは個々の動きの速さだけでなく、**音楽の構造と映像の構造が同じ表に書かれていること**から生まれる。

### 6-5 まとめ：何が上がったのか（仮説）

1. **時間を関数として書く**：「コマごとの状態」ではなく「時刻 → 絵」の式として書く。だから任意の時刻を何度でも同じように描け、拍・コマの内側・並列書き出しのどれにも対応できる
2. **定番の部品を正しく選んで組む**：Penner のイージング、mulberry32、beesandbombs のブラー、Synth Secrets の打楽器。部品は昔からある。どれをどの拍に割り当てるかの判断が速く、正確になった
3. **音楽の構造を理解して割り振る**：4つ打ち、裏拍のハット、2・4拍目のスネア、4小節ごとの和音、ブレイクとドロップ。映像の場面転換を、それと同じ単位で切っている
4. **ビジョンで検品する**：空間の誤りは一覧画像で自分で見つけて直す

【仮説】1〜3はビジョンの向上では説明できない。むしろ「時間をコードで扱う推論」と「音楽・アニメーションの定石の知識」の組み合わせが効いていると考えられる。これを検証するには、同じ依頼をビジョンなし（書き出しを見せない）で走らせ、キレ（初速・拍とのずれ・溜めの構造）を数値で比べる実験が要る。【TODO】

---

## 第7部 JIZURA との比較

JIZURA（字面）https://852wa.github.io/JIZURA/ は、hakoniwa 氏（852wa）が MIT ライセンスで公開している文字PV（リリックモーション）ツールだ。リポジトリ https://github.com/852wa/JIZURA は2026年9月23日作成で、この記事の数日前である。同じ時期に、まったく違うアプローチで「拍に合わせて動く文字」を作っている人がいる。筆者自身を含め、こうした道具を作っている人は少なくない。

| | この作例 | JIZURA |
|---|---|---|
| 音 | コードで作る（出力） | 手持ちの曲を読み込む（入力） |
| テンポ | 決めうち（`BPM = 128`） | 仮説つき推定（125BPM 中心の重み）、手入力、タップ同期 |
| 同期の保証 | 同じ表から作るので構造上ずれない | 検出の精度しだい。今回の曲では 0.76% の誤差で46秒ごとに1拍ずれた |
| 歌詞・曲の構造 | 知らない（拍の表に人が書く） | 歌詞の行と LRC の時刻を使う |
| 演出 | 1本のための専用コード | 707部品・24スタイルの組み合わせ、シードで毎回変わる |
| コマ打ち | 60fps、ブラー10回 | 既定は「2コマ打ち」（12枚/秒、`koma: 12`）。アニメ的なキレ |
| 書き出し | ヘッドレス Chromium → ffmpeg | ブラウザ内 WebCodecs で MP4、After Effects 用パネルも |
| 共通点 | mulberry32、Penner 系のバウンス（`7.5625`、`2.75`）、時刻を指定して1コマを描く設計 | 同左 |

JIZURA の既定が「2コマ打ち」なのは、キレの理論から見て興味深い。動きを24コマ中12枚に間引くと、1枚ごとの移動量が大きくなり、日本のアニメや文字PVに特有のカクッとしたキレが出る。作例は逆に、コマの内側まで描いてブラーでなめらかにしている。同じ「キレ」でも、方向が正反対の2つの設計がある。【TODO】この対比を実験で見せる（作例を2コマ打ちにしたもの、JIZURA を `koma: 0` にしたもの）。

---

## 第8部 HTML で描いて動画にする、という系譜

- Remotion https://github.com/remotion-dev/remotion （React、フレーム番号から描く）
- Motion Canvas https://github.com/motion-canvas/motion-canvas
- Manim https://www.manim.community/ （3Blue1Brown 由来 https://github.com/3b1b/manim 、Python）
- CCapture.js https://github.com/spite/ccapture.js 、timecut https://github.com/tungs/timecut （ブラウザの時計を止めてコマを撮る）
- canvas-sketch https://github.com/mattdesl/canvas-sketch
- hyperframes https://github.com/heygen-com/hyperframes （HeyGen、Apache-2.0、“Write HTML. Render video. Built for agents.” 拍の検出 https://github.com/heygen-com/hyperframes/blob/main/packages/core/src/beats/beatDetection.ts 、After Effects 方式のモーションブラー https://github.com/heygen-com/hyperframes/blob/main/packages/engine/src/services/motionBlur.ts 。エージェント向け指示書でいう beat https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-creative/references/beat-direction.md は主に「場面」の意味）

作例は、これらのどれも読み込まずに、同じことを数百行で書いている。

---

## 第9部 次にやること【TODO】

- [ ] Remotion の書き出し精度の検証データ（筆者の実証）を第5部に書く
- [ ] Blender の例（第6部）
- [ ] ビジョンなしで同じ依頼を走らせる比較実験（第6部 6-5）
- [ ] 作例を「曲を知る」形に拡張する：LRC とセクション（Aメロ・サビ・ブレイク）を拍の表に取り込む
- [ ] 2コマ打ちとブラーの対比実験（第7部）
- [ ] aubio のパラメータを変えた再測定（第4部 4-1）
- [ ] ITU-R BT.1359 の数値を原文で確認（第6部 6-3）
- [x] 比較動画の公開範囲（楽曲の権利）を確認 → 公開可（2026-09-28）

---

## 付録 実験の再現

```sh
# 環境：macOS、Google Chrome、ffmpeg、aubio、Python 3 + playwright + numpy
cd experiments/ppsg-elena
# serve/ に song.mp3・song.lrc・jizura.html（JIZURA の index.html）を置く（シンボリックリンク可）
python jizura_render.py --start 33.784 --end 56.110 --out jizura_auto.mp4
python jizura_render.py --start 33.784 --end 56.110 --bpm 172 --offset 0.296 --out jizura_172.mp4
python opus_render.py            # serve/opus.html（motion/index.html の拍を差し替えたもの）
```

測定値はすべて 2026年9月27日、筆者の MacBook（Apple Silicon）で得たもの。
