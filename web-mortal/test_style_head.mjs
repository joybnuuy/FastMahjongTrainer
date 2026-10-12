// 스타일 헤드 검증: (1) JS 계산이 numpy 기준값과 같은가  (2) phi 출력을 추가한 엔진이 원래 엔진과 같은 q 를 내고 styles 가 붙는가
// 사용: node web-mortal/test_style_head.mjs      (먼저: tools/add_phi_output.py, tools/export_styles.py, exp/make_style_ref.py)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import { MortalWeb } from './mortal-web.js';
import { parseStyleHead, styleQs } from './style-head.js';
import { parseMjlog } from '../v5/public/v4/js/mjlog.js';
import { toMjai } from '../v5/public/v4/js/mjai.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(fs.readFileSync(path.join(HERE, 'out/styles/styles.json'), 'utf8'));
const head = parseStyleHead(meta, fs.readFileSync(path.join(HERE, 'out/styles/styles.bin')));
let bad = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'ERR'} ${name} ${extra}`); if (!ok) bad++; };

// (1) 수치 일치
const ref = JSON.parse(fs.readFileSync(path.join(HERE, 'exp-data/style_ref.json'), 'utf8'));
let worst = 0, n = 0;
for (const r of ref) {
  const got = styleQs(head, Float32Array.from(r.phi), r.q, r.mask);
  for (const id of Object.keys(r.styles)) for (let i = 0; i < r.q.length; i++) { worst = Math.max(worst, Math.abs(got[id][i] - r.styles[id][i])); n++; }
}
check('JS 스타일 q 가 numpy 와 일치', worst < 1e-3, `(비교 ${n}개, 최대 오차 ${worst.toExponential(2)})`);

// (2) 엔진 통합
const core = await import(pathToFileURL(path.join(HERE, 'pkg', 'mortal_wasm_core.js')).href);
await core.default({ module_or_path: fs.readFileSync(path.join(HERE, 'pkg', 'mortal_wasm_core_bg.wasm')) });
const plain = await MortalWeb.create({ ort, core, model: fs.readFileSync(path.join(HERE, 'out/quant/qat-wo-lr1e-6.onnx')) });
const withPhi = await MortalWeb.create({ ort, core, model: fs.readFileSync(path.join(HERE, 'out/quant/qat-wo-lr1e-6.phi.onnx')), styleHead: head });
let threw = false;
try { await MortalWeb.create({ ort, core, model: fs.readFileSync(path.join(HERE, 'out/quant/qat-wo-lr1e-6.onnx')), styleHead: head }); } catch { threw = true; }
check('phi 출력 없는 엔진에 스타일 헤드를 주면 오류', threw);

const file = fs.readdirSync(path.join(HERE, 'exp-data/meijin')).filter(f => f.endsWith('.xml'))[3];
const game = parseMjlog(fs.readFileSync(path.join(HERE, 'exp-data/meijin', file), 'utf8'));
const { events } = toMjai(game);
const reqs = [];
events.forEach((e, i) => { if (e.type === 'tsumo' && e.actor === 0 && reqs.length < 12) reqs.push({ seat: 0, idx: i }); });
const a = await plain.analyze(events, reqs), b = await withPhi.analyze(events, reqs);
let dq = 0, withStyles = 0, differ = 0, finite = true;
b.forEach((r, i) => {
  if (!r.q) return;
  r.q.forEach((x, j) => { dq = Math.max(dq, Math.abs(x - a[i].q[j])); });
  if (r.styles) {
    withStyles++;
    for (const id of Object.keys(r.styles)) r.styles[id].forEach((x, j) => { if (!Number.isFinite(x)) finite = false; if (Math.abs(x - r.q[j]) > 1e-4) differ++; });
  }
});
check('phi 엔진의 기본 q 가 원래 엔진과 같음', dq < 1e-4, `(최대 차이 ${dq.toExponential(2)}, 판단 ${b.length}개)`);
check('모든 판단에 styles 가 붙고 유한함', withStyles === b.filter(r => r.q).length && finite && Object.keys(b[0].styles || {}).length === head.styles.length, `(스타일 ${head.styles.length}개)`);
check('스타일 q 가 기본 q 와 다름(보정이 실제로 적용)', differ > 0, `(차이 있는 값 ${differ}개)`);
console.log(bad ? `\n문제 ${bad}건` : '\n모두 통과');
process.exit(bad ? 1 : 0);
