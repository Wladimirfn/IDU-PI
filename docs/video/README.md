# Video de presentación de IDU-PI

Las fuentes del video para YouTube (3:32, 1920×1080, 30 fps). Se sigue la regla visual del stack
creativo: las escenas con datos legibles se hacen con código, en un HTML determinista con
`seek(t)` puro. No se usa footage generado por IA.

El MP4 no se versiona porque pesa unos 64 MB. Se regenera con los pasos de abajo.

| Archivo | Qué es |
| :--- | :--- |
| `script.py` | Guion en español, frase por frase, y las re-escrituras fonéticas para la voz |
| `voice.py` | Narración con Kokoro (`em_alex`). Genera `voice.wav`, `timeline.json` y `subtitulos.srt` |
| `music.py` | Banda sonora ambiental original, sintetizada sin samples |
| `film.html` | La película: 14 escenas en estética Kanagawa, animadas por las marcas de tiempo de cada frase |
| `timeline.js`, `icons.js` | La línea de tiempo y los iconos `soul-icons` que consume `film.html` |
| `render.js` | Render cuadro a cuadro con Playwright y ffmpeg. Corre en segmentos paralelos |
| `subtitulos.srt` | Subtítulos para subir a YouTube |
| `youtube-descripcion.md` | Título, descripción, capítulos y etiquetas |
| `miniatura-youtube.jpg` | Miniatura de 1280×720 |

## Regenerar

Requisitos: Python con `kokoro-onnx soundfile numpy scipy`, Node con Playwright, y ffmpeg. Los
modelos `kokoro-v1.0.onnx` y `voices-v1.0.bin` se descargan de las releases de
`thewh1teagle/kokoro-onnx` y van en `../voices/` respecto de esta carpeta.

```bash
python voice.py em_alex 1.0
```

```bash
python music.py
```

```bash
python -c "import json;print('window.TL='+json.dumps(json.load(open('timeline.json')),ensure_ascii=False)+';')" > timeline.js
```

```bash
for i in 0 1 2 3; do node render.js $i 4 30 & done; wait
```

```bash
printf "file 'seg0.mp4'\nfile 'seg1.mp4'\nfile 'seg2.mp4'\nfile 'seg3.mp4'\n" > list.txt && ffmpeg -f concat -safe 0 -i list.txt -c copy video.mp4
```

```bash
ffmpeg -i voice.wav -i music.wav -filter_complex "[0:a]aresample=48000,pan=stereo|c0=c0|c1=c0,asplit=2[v][sc];[1:a]volume=0.30[m];[m][sc]sidechaincompress=threshold=0.02:ratio=5:attack=30:release=600[md];[v][md]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-14:TP=-1.5:LRA=11[out]" -map "[out]" -ar 48000 mix.wav
```

```bash
ffmpeg -i video.mp4 -i mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart IDU-PI-presentacion.mp4
```

Para previsualizar en el navegador sin audio, abre `film.html?play`. Para ver un instante
concreto, abre `film.html?t=73.5`.

Las fuentes tipográficas de `f/` son Space Grotesk, Source Serif 4 y JetBrains Mono, todas con
licencia SIL OFL, empaquetadas por Fontsource.
