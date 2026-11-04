import json, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
from script import SCENES, to_speech

VOICE = sys.argv[1] if len(sys.argv) > 1 else "em_alex"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
SR = 24000
k = Kokoro("../voices/kokoro-v1.0.onnx", "../voices/voices-v1.0.bin")

LEAD = {"intro": 2.2}
GAP = 0.32          # pausa entre frases
LEAD_DEFAULT = 0.7  # silencio al empezar cada escena
TAIL = 0.9          # silencio al terminar cada escena
END_TAIL = 4.0


def trim(x, thr=0.006):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(0.02 * SR)); b = min(len(x), idx[-1] + int(0.06 * SR))
    y = x[a:b].copy()
    f = int(0.012 * SR)
    y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
    return y


out = []
timeline = []
t = 0.0
for si, (sid, phrases) in enumerate(SCENES):
    start = t
    t += LEAD.get(sid, LEAD_DEFAULT)
    cues = []
    for p in phrases:
        s, sr = k.create(to_speech(p), voice=VOICE, speed=SPEED, lang="es")
        assert sr == SR
        s = trim(s.astype(np.float32))
        cues.append({"t": round(t - start, 3), "d": round(len(s) / SR, 3), "text": p})
        out.append((t, s))
        t += len(s) / SR + GAP
    t += TAIL - GAP
    if si == len(SCENES) - 1:
        t += END_TAIL
    timeline.append({"id": sid, "start": round(start, 3), "dur": round(t - start, 3), "cues": cues})
    print(f"{sid:10s} {start:7.2f}s  dur {t-start:6.2f}s", flush=True)

total = t
buf = np.zeros(int(total * SR) + SR, dtype=np.float32)
for st, s in out:
    i = int(st * SR); buf[i:i + len(s)] += s
buf = buf / max(1e-6, np.abs(buf).max()) * 0.89
sf.write("voice.wav", buf, SR)
json.dump({"total": round(total, 3), "scenes": timeline}, open("timeline.json", "w"), ensure_ascii=False, indent=1)


def ts(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"

with open("subtitulos.srt", "w") as f:
    n = 1
    for sc in timeline:
        for c in sc["cues"]:
            a = sc["start"] + c["t"]; b = a + c["d"] + 0.15
            f.write(f"{n}\n{ts(a)} --> {ts(b)}\n{c['text']}\n\n"); n += 1
print("total", round(total, 2))
