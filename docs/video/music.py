# Banda sonora ambiental original, sintetizada desde cero (sin samples).
import json
import numpy as np, soundfile as sf

SR = 48000
T = json.load(open("timeline.json"))["total"]
N = int(T * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

# Progresión: Am9 · Fmaj7 · Cmaj7 · G6sus — 8 s por acorde
CH = [[57, 64, 67, 71, 72], [53, 60, 64, 67, 69], [48, 55, 59, 64, 67], [55, 62, 64, 67, 71]]
BASS = [45, 41, 48, 43]
BAR = 8.0

L = np.zeros(N); R = np.zeros(N)

def env_chord(i):
    # envolvente suave con solape de 1.5 s entre acordes
    a = i * BAR; b = a + BAR
    e = np.clip((t - (a - 1.5)) / 3.0, 0, 1) * np.clip((b + 1.5 - t) / 3.0, 0, 1)
    return np.sin(e * np.pi / 2) ** 2

nbars = int(np.ceil(T / BAR)) + 1
for i in range(nbars):
    a = i * BAR
    lo = max(0, int((a - 2) * SR)); hi = min(N, int((a + BAR + 2) * SR))
    if lo >= hi: continue
    tt = t[lo:hi]
    e = env_chord(i)[lo:hi]
    chord = CH[i % 4]
    for j, m in enumerate(chord):
        f = hz(m)
        for det, pan in ((-0.09, 0.25), (0.11, 0.75)):
            ph = rng.uniform(0, 2 * np.pi)
            v = (np.sin(2 * np.pi * (f + det) * tt + ph)
                 + 0.28 * np.sin(2 * np.pi * 2 * (f + det) * tt + ph)
                 + 0.08 * np.sin(2 * np.pi * 3 * (f + det) * tt))
            trem = 0.85 + 0.15 * np.sin(2 * np.pi * (0.07 + 0.02 * j) * tt + j)
            L[lo:hi] += v * e * trem * (1 - pan) * 0.05
            R[lo:hi] += v * e * trem * pan * 0.05
    fb = hz(BASS[i % 4] - 12)
    bv = np.sin(2 * np.pi * fb * tt) + 0.2 * np.sin(2 * np.pi * 2 * fb * tt)
    L[lo:hi] += bv * e * 0.09; R[lo:hi] += bv * e * 0.09

# Campanitas: arpegio escaso sobre las notas del acorde, cada 1 s con probabilidad
step = 0.5
for k in range(int(T / step)):
    st = k * step
    if st < 10 or rng.random() > 0.34: continue
    chord = CH[int(st // BAR) % 4]
    m = chord[rng.integers(0, len(chord))] + 12 * rng.integers(1, 3)
    f = hz(m); d = 2.8
    lo = int(st * SR); hi = min(N, lo + int(d * SR))
    tt = t[lo:hi] - st
    v = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2.01 * f * tt)) * np.exp(-tt * 2.2) * np.minimum(1, tt / 0.004)
    pan = rng.uniform(0.2, 0.8)
    L[lo:hi] += v * (1 - pan) * 0.045; R[lo:hi] += v * pan * 0.045

# Paso bajo de un polo para suavizar
def lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); s = 0.0
    from scipy.signal import lfilter  # noqa
    return lfilter([1 - a], [1, -a], x)

try:
    L = lp(L, 3500); R = lp(R, 3500)
except Exception:
    pass

# Reverb simple: delays de retroalimentación cruzados
def verb(x, y):
    outL = x.copy(); outR = y.copy()
    for dly, g in ((0.113, 0.32), (0.171, 0.27), (0.239, 0.22), (0.347, 0.16)):
        n = int(dly * SR)
        for rep in range(1, 5):
            sh = n * rep; gg = g ** rep
            if sh >= N: break
            outL[sh:] += y[:-sh] * gg; outR[sh:] += x[:-sh] * gg
    return outL, outR
L, R = verb(L, R)

# Fade in/out global
fi = np.clip(t / 4.0, 0, 1); fo = np.clip((T - t) / 5.0, 0, 1)
L *= fi * fo; R *= fi * fo
m = max(np.abs(L).max(), np.abs(R).max())
L /= m; R /= m
sf.write("music.wav", np.stack([L, R], 1).astype(np.float32), SR)
print("music", T)
