const { chromium } = require('playwright');
const { spawn } = require('child_process');
const [,, idx, n, fps] = process.argv; const I=+idx, N=+n, FPS=+fps;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + __dirname + '/film.html');
  await p.evaluate(() => window.READY);
  const total = await p.evaluate(() => window.TL.total);
  const frames = Math.ceil(total * FPS), per = Math.ceil(frames / N), a = I * per, z = Math.min(frames, a + per);
  const ff = spawn('ffmpeg', ['-y','-loglevel','error','-f','image2pipe','-framerate',String(FPS),'-c:v','mjpeg','-i','-','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-r',String(FPS),__dirname+`/seg${I}.mp4`], { stdio: ['pipe','inherit','inherit'] });
  const t0 = Date.now();
  for (let f = a; f < z; f++) {
    await p.evaluate(t => seek(t), f / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - a) % 300 === 0) console.log(`seg${I} ${f - a}/${z - a} ${((Date.now()-t0)/1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
  console.log(`seg${I} done ${((Date.now()-t0)/1000).toFixed(0)}s`);
})();
