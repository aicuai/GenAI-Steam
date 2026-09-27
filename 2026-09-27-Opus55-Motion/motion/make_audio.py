"""映像と同じ拍番号で音を鳴らす。サンプル音源は使わず、すべて波形の計算で作る。

  python make_audio.py  -> audio.wav (48kHz / 16bit / stereo / 15秒)
"""
import wave
import numpy as np

SR, BPM, BEATS = 48000, 128, 32
BEAT = 60 / BPM
N = int(round(BEAT * BEATS * SR))
rng = np.random.default_rng(1)

kick_bus = np.zeros((N, 2))
bus = np.zeros((N, 2))   # キック以外（サイドチェインで一瞬小さくする）


def at(beat):
    return int(round(beat * BEAT * SR))


def add(dst, beat, sig, pan=0.0, gain=1.0):
    i = at(beat)
    if sig.ndim == 1:
        sig = np.stack([sig * (1 - max(0, pan)), sig * (1 + min(0, pan))], 1)
    n = min(len(sig), N - i)
    if n > 0:
        dst[i:i + n] += sig[:n] * gain


def tvec(sec):
    return np.arange(int(sec * SR)) / SR


def lowpass_fft(x, fc):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)[:, None] if x.ndim == 2 else np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), n=len(x), axis=0)


def highpass(x, fc):
    return x - lowpass_fft(x, fc)


# ---- 楽器 ----
def kick(big=False):
    t = tvec(0.6 if big else 0.35)
    f = 44 + 150 * np.exp(-t * 32)                       # 低い音が一瞬で下がっていく
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (4 if big else 9))
    s[:200] += rng.uniform(-1, 1, 200) * np.linspace(0.6, 0, 200)   # アタックのクリック
    return np.tanh(s * 1.6)


def hat():
    t = tvec(0.06)
    return highpass(rng.uniform(-1, 1, len(t)), 7000) * np.exp(-t * 70)


def snare():
    t = tvec(0.25)
    n = highpass(rng.uniform(-1, 1, len(t)), 1500) * np.exp(-t * 16)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    return n * 0.8 + tone * 0.5


def whoosh(beats, rise=True):
    t = tvec(beats * BEAT)
    n = rng.uniform(-1, 1, len(t))
    u = t / t[-1]
    env = u ** 2 if rise else (1 - u) ** 2
    fc = 300 + 7000 * (u ** 2 if rise else (1 - u))
    # 時間とともにカットオフが動く1極ローパス（区間が短いのでループで十分）
    y = np.zeros_like(n); z = 0.0
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    for i in range(len(n)):
        z += a[i] * (n[i] - z); y[i] = z
    return y * env * 2.2


def supersaw(freqs, beats):
    """少しずつ音程をずらしたノコギリ波を7本重ねる（左右で位相を変えて広げる）"""
    t = tvec(beats * BEAT)
    det = np.array([-24, -14, -6, 0, 6, 14, 24]) / 1200
    out = np.zeros((len(t), 2))
    for f in freqs:
        for d in det:
            for ch in range(2):
                ph = rng.random()
                out[:, ch] += 2 * ((f * 2 ** d * t + ph) % 1) - 1
    env = np.minimum(1, t / 0.02) * np.minimum(1, (t[-1] - t) / 0.05)
    return lowpass_fft(out, 2600) * env[:, None] / (len(freqs) * 7)


def bass(f, beats):
    t = tvec(beats * BEAT)
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)
    return s * np.exp(-t * 3) * np.minimum(1, (t[-1] - t) / 0.01)


def blip(f):
    t = tvec(0.12)
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 40)


NOTE = lambda n: 440 * 2 ** ((n - 69) / 12)
CHORDS = {"Am": [57, 60, 64], "F": [53, 57, 60], "C": [60, 64, 67], "G": [55, 59, 62]}
ROOT = {"Am": 45, "F": 41, "C": 48, "G": 43}

# ---- 楽譜（拍番号で書く）----
kicks = []
for b in range(4):                                 # 0–4拍：点に合わせた電子音
    add(bus, b, blip(880 if b < 3 else 1320), gain=0.35)
add(bus, 2, whoosh(2), gain=0.5)                   # 3→4拍の「シュッ」

for b in range(4, 28):                             # 4つ打ち
    add(kick_bus, b, kick(), gain=0.9); kicks.append(b)
for b in range(8, 28):                             # 裏拍のハット
    add(bus, b + 0.5, hat(), pan=0.3 if b % 2 else -0.3, gain=0.35)
for b in range(12, 28):
    if b % 2 == 1:
        add(bus, b, snare(), gain=0.5)             # 2・4拍目のスネア
for b in (7, 15, 23):
    add(bus, b, whoosh(1), gain=0.45)              # 場面転換の前に

prog_ = [(4, "Am"), (8, "F"), (12, "C"), (16, "G"), (20, "Am"), (24, "F")]
for b, ch in prog_:
    add(bus, b, supersaw([NOTE(n) for n in CHORDS[ch]], 4), gain=0.55)
    if b >= 8:
        for k in range(4):                         # ベースは裏の8分
            add(bus, b + k + 0.5, bass(NOTE(ROOT[ch]), 0.5), gain=0.45)
add(bus, 24, whoosh(3.75), gain=0.8)               # 爆発へ向けて上がっていく

# ---- サイドチェイン：キックのたびに他の音を一瞬小さく ----
ts = np.arange(N) / SR
kt = np.array(kicks) * BEAT
idx = np.searchsorted(kt, ts, side="right") - 1
since = np.where(idx >= 0, ts - kt[np.clip(idx, 0, None)], 10)
duck = 1 - 0.75 * np.exp(-since / 0.09)
mix = kick_bus + bus * duck[:, None]

# ---- 決めの直前：0.1秒ほど完全な無音 ----
s0, s1 = at(27.75), at(28)
fade = 96
mix[s0 - fade:s0] *= np.linspace(1, 0, fade)[:, None]
mix[s0:] = 0

# ---- 28拍目：爆発と、その後 ----
hit = np.zeros((N, 2))
add(hit, 28, kick(big=True), gain=1.2)
t = tvec(2.5)
crash = highpass(rng.uniform(-1, 1, (len(t), 2)), 4000) * np.exp(-t * 2.2)[:, None]
add(hit, 28, crash, gain=0.5)
boom = np.sin(2 * np.pi * 38 * t) * np.exp(-t * 1.5)
add(hit, 28, boom, gain=0.7)
add(hit, 28, supersaw([NOTE(n) for n in [57, 60, 64, 69]], 4), gain=0.75)
for b in (30, 31):
    add(hit, b, kick(), gain=0.7)
mix += hit

# ---- マスター：柔らかく潰して -1dBFS へ ----
mix = np.tanh(mix * 1.3)
end = np.ones(N); end[-int(0.3 * SR):] = np.linspace(1, 0, int(0.3 * SR))
mix *= end[:, None]
mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))

with wave.open("audio.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("done -> audio.wav", f"{N / SR:.2f}s")
