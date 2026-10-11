// onnxruntime-web(WASM)에서 양자화 변형들의 로드 여부 / 지연시간 / fp32 대비 정확도를 천봉 평가셋 일부로 확인
// 사용: node bench_variants_node.mjs [샘플수=60] [threads=1] [변형...]
import * as ort from 'onnxruntime-web';
import fs from 'node:fs';

const N = Number(process.argv[2] || 60), threads = Number(process.argv[3] || 1);
const names = process.argv.slice(4);
const variants = names.length ? names : ['fp16', 'int8-st-minmax-all', 'int8-st-minmax-conv', 'int8-st-minmax-conv-edge', 'int8-st-pct-conv-edge'];
ort.env.wasm.numThreads = threads;

const meta = JSON.parse(fs.readFileSync('out/data/eval.json', 'utf8'));
const OBS = 1012 * 34;
const obsBuf = fs.readFileSync('out/data/eval.obs.f32');
const obsAll = new Float32Array(obsBuf.buffer, obsBuf.byteOffset, meta.n * OBS);
const maskAll = fs.readFileSync('out/data/eval.mask.u8');
// 합법 행동이 2개 이상인 샘플만, 앞에서 N개
const idx = [];
for (let i = 0; i < meta.n && idx.length < N; i++) {
  let c = 0; for (let a = 0; a < 46; a++) c += maskAll[i * 46 + a];
  if (c >= 2) idx.push(i);
}
const feed = i => ({
  obs: new ort.Tensor('float32', obsAll.subarray(i * OBS, (i + 1) * OBS), [1, 1012, 34]),
  mask: new ort.Tensor('bool', maskAll.subarray(i * 46, (i + 1) * 46), [1, 46]),
});

async function runAll(path) {
  const t0 = performance.now();
  const sess = await ort.InferenceSession.create(fs.readFileSync(path), { executionProviders: ['wasm'] });
  const loadMs = performance.now() - t0;
  await sess.run(feed(idx[0])); // warmup
  const outs = [];
  const t1 = performance.now();
  for (const i of idx) outs.push(Float32Array.from((await sess.run(feed(i))).q.data));
  return { outs, loadMs, ms: (performance.now() - t1) / idx.length };
}

const base = await runAll('out/mortal.onnx');
console.log(`threads=${threads} N=${idx.length}`);
console.log(`${'variant'.padEnd(28)} ${'MB'.padStart(6)} ${'load ms'.padStart(8)} ${'ms/run'.padStart(7)} ${'gapΔmean'.padStart(9)} ${'top1'.padStart(6)}`);
console.log(`${'fp32 (baseline)'.padEnd(28)} ${(fs.statSync('out/mortal.onnx').size / 1e6).toFixed(1).padStart(6)} ${base.loadMs.toFixed(0).padStart(8)} ${base.ms.toFixed(0).padStart(7)}`);
for (const v of variants) {
  const p = `out/quant/${v}.onnx`;
  try {
    const r = await runAll(p);
    let gsum = 0, gcnt = 0, agree = 0;
    r.outs.forEach((q, k) => {
      const t = base.outs[k], m = maskAll.subarray(idx[k] * 46, (idx[k] + 1) * 46);
      let mt = -Infinity, ms = -Infinity, at = 0, as = 0;
      for (let a = 0; a < 46; a++) if (m[a]) { if (t[a] > mt) { mt = t[a]; at = a; } if (q[a] > ms) { ms = q[a]; as = a; } }
      for (let a = 0; a < 46; a++) if (m[a]) { gsum += Math.abs((mt - t[a]) - (ms - q[a])); gcnt++; }
      if (at === as) agree++;
    });
    console.log(`${v.padEnd(28)} ${(fs.statSync(p).size / 1e6).toFixed(1).padStart(6)} ${r.loadMs.toFixed(0).padStart(8)} ${r.ms.toFixed(0).padStart(7)} ${(gsum / gcnt).toFixed(5).padStart(9)} ${(agree / r.outs.length).toFixed(3).padStart(6)}`);
  } catch (e) {
    console.log(`${v.padEnd(28)} 실패: ${String(e.message || e).slice(0, 160)}`);
  }
}
