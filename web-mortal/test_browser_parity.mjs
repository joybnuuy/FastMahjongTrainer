// 브라우저(app, proxy 워커)에서 계산한 결과(out/browser_result.json)를 Node(onnxruntime-web, 동일 모델)와 비교
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import { MortalWeb } from './mortal-web.js';
import { parseMjlog } from '../public/js/mjlog.js';
import { toMjai } from '../public/js/mjai.js';

const b = JSON.parse(fs.readFileSync('out/browser_result.json', 'utf8'));
const core = await import(pathToFileURL(path.resolve('pkg/mortal_wasm_core.js')).href);
await core.default({ module_or_path: fs.readFileSync('pkg/mortal_wasm_core_bg.wasm') });
const web = await MortalWeb.create({ ort, core, model: fs.readFileSync('app/model/mortal.onnx') });
const { events } = toMjai(parseMjlog(fs.readFileSync(`../cache/${b.id}.xml`, 'utf8')));
const res = await web.analyze(events, b.reqs);
let worst = 0, bad = 0;
for (const r of res) {
  const x = b.res.find(y => y.idx === r.idx);
  if (String(x.mask) !== String(r.mask)) { bad++; console.log('mask 불일치', r.idx); continue; }
  worst = Math.max(worst, ...r.q.map((v, i) => Math.abs(v - x.q[i])));
}
console.log(`points=${res.length} mask불일치=${bad} 최대|dq|(브라우저 vs Node)=${worst.toExponential(2)} (브라우저 값은 소수 5자리 반올림)`);
