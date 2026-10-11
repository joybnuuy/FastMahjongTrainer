// 캐시된 Python 분석 결과(cache/*.ai.json)와 wasm+onnxruntime-web 결과를 비교한다.
// 사용: node web-mortal/test_e2e.mjs [게임수=3]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import { MortalWeb } from './mortal-web.js';
import { parseMjlog } from '../public/js/mjlog.js';
import { toMjai } from '../public/js/mjai.js';
import { collectPoints } from '../public/js/points.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '..', 'cache');
const N = Number(process.argv[2] || 3);

const core = await import(pathToFileURL(path.join(HERE, 'pkg', 'mortal_wasm_core.js')).href);
await core.default({ module_or_path: fs.readFileSync(path.join(HERE, 'pkg', 'mortal_wasm_core_bg.wasm')) });
const web = await MortalWeb.create({ ort, core, model: fs.readFileSync(path.join(HERE, 'out', 'mortal.onnx')) });

// REACH=1 이면 리치 분기(reach fork)가 들어 있는 게임만 고른다
const onlyReach = process.env.REACH === '1';
const ids = fs.readdirSync(CACHE).filter(f => f.endsWith('.ai.json'))
  .filter(f => !onlyReach || fs.readFileSync(path.join(CACHE, f), 'utf8').includes('"reach":{'))
  .map(f => f.replace('.ai.json', '')).slice(0, N);
let nPts = 0, nBad = 0, worstQ = 0, nReach = 0, t0 = performance.now();
for (const id of ids) {
  const game = parseMjlog(fs.readFileSync(path.join(CACHE, id + '.xml'), 'utf8'));
  const ref = JSON.parse(fs.readFileSync(path.join(CACHE, id + '.ai.json'), 'utf8')).points;
  const { events, at } = toMjai(game);
  const pts = collectPoints(game, { effMax: 999, defMax: 999, effPerRound: 999 }).filter(p => ref[p.key]);
  const idxOf = p => at[`${p.r}:${p.drawI}`];
  const reqs = pts.map(p => ({ seat: p.seat, idx: idxOf(p) }));
  fs.mkdirSync(path.join(HERE, 'out', 'req'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'out', 'req', id + '.json'), JSON.stringify({ events, requests: reqs }));
  const res = await web.analyze(events, reqs);
  // CPU fp32 기준값(ref_cpu.py)이 있으면 그걸 우선 사용 (캐시는 CUDA+AMP라 fp16 노이즈가 있음)
  const cpuF = path.join(HERE, 'out', 'req', id + '.cpu.json');
  const cpu = fs.existsSync(cpuF) ? new Map(JSON.parse(fs.readFileSync(cpuF, 'utf8')).map(r => [`${r.seat}:${r.idx}`, r])) : null;
  const tol = cpu ? 1e-3 : 2e-2;
  const byKey = new Map(res.map(r => [`${r.seat}:${r.idx}`, r]));
  for (const p of pts) {
    const exp = cpu ? cpu.get(`${p.seat}:${idxOf(p)}`) : ref[p.key];
    const got = byKey.get(`${p.seat}:${idxOf(p)}`);
    if (!exp) continue;
    nPts++;
    const cmp = (a, b, what) => {
      if (!a || !b) { nBad++; console.log(`  ${id} ${p.key} ${what}: 한쪽만 존재`); return; }
      if (String(a.mask) !== String(b.mask)) { nBad++; console.log(`  ${id} ${p.key} ${what}: mask 불일치 ${a.mask} vs ${b.mask}`); return; }
      const d = Math.max(...a.q.map((v, i) => Math.abs(v - b.q[i])));
      worstQ = Math.max(worstQ, d);
      if (d > tol) { nBad++; console.log(`  ${id} ${p.key} ${what}: |dq|=${d}`); }
    };
    cmp(exp, got, 'main');
    if (exp?.reach || got?.reach) { nReach++; cmp(exp?.reach, got?.reach, 'reach'); }
  }
  console.log(id, 'ok');
}
console.log(`games=${ids.length} points=${nPts} reachForks=${nReach} mismatches=${nBad} worst|dq|=${worstQ.toExponential(2)} time=${((performance.now() - t0) / 1000).toFixed(1)}s`);
process.exit(nBad ? 1 : 0);
