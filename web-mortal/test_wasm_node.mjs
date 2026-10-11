// onnxruntime-web(WASM)으로 mortal.onnx를 돌려 PyTorch 참조값과 비교 + 지연시간 측정 (Node에서)
import * as ort from 'onnxruntime-web';
import fs from 'node:fs';

const threads = Number(process.argv[2] || 1);
ort.env.wasm.numThreads = threads;
ort.env.wasm.simd = true;

const ref = JSON.parse(fs.readFileSync('out/ref.json', 'utf8'));
const buf = fs.readFileSync('out/ref_obs.bin');
const obsAll = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const N = 2, OBS = 1012 * 34;

let t = performance.now();
const sess = await ort.InferenceSession.create(fs.readFileSync('out/mortal.onnx'), { executionProviders: ['wasm'] });
console.log(`load ${(performance.now() - t).toFixed(0)}ms threads=${threads}`);

const feeds = n => ({
  obs: new ort.Tensor('float32', obsAll.slice(0, n * OBS), [n, 1012, 34]),
  mask: new ort.Tensor('bool', Uint8Array.from(ref.mask.slice(0, n).flat()), [n, 46]),
});

const out = (await sess.run(feeds(N))).q.data;
let worst = 0;
for (let i = 0; i < N * 46; i++) {
  const r = ref.q[Math.floor(i / 46)][i % 46];
  const g = out[i];
  if (r <= -1e8) { if (g !== -Infinity && g > -1e8) throw new Error('mask mismatch at ' + i); continue; }
  worst = Math.max(worst, Math.abs(r - g));
}
console.log('max |dq| vs PyTorch =', worst);

for (const n of [1, 2]) {
  const f = feeds(n);
  await sess.run(f);
  const T = 8, s = performance.now();
  for (let i = 0; i < T; i++) await sess.run(f);
  console.log(`batch=${n}: ${((performance.now() - s) / T).toFixed(0)} ms/run`);
}
