// 천봉(Tenhou) 로그에서 양자화 보정/평가용 (obs, mask) 샘플을 뽑는다.
// 4인 대국만, 모든 좌석의 "행동 가능 시점"(쯔모 후 타패/리치/깡/화료, 타가 타패에 대한 치/퐁/론 등)에서 확률적으로 샘플링.
// 보정(calib)과 평가(eval)는 서로 다른 대국에서 뽑아 누수를 막는다.
// 사용: node gen_dataset.mjs [calibGames=60] [evalGames=40] [perGame=40]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { viewFor } from './mortal-web.js';
import { parseMjlog } from '../public/js/mjlog.js';
import { toMjai } from '../public/js/mjai.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '..', 'cache');
const OUT = path.join(HERE, 'out', 'data');
fs.mkdirSync(OUT, { recursive: true });
const TRAIN_ONLY = process.argv[2] === 'train'; // node gen_dataset.mjs train [perGame=24]  → 보정/평가 100판을 제외한 나머지 대국에서 학습셋만 생성
const [NC, NE, PER] = TRAIN_ONLY ? [60, 40, Number(process.argv[3] || 24)] : [60, 40, 40].map((d, i) => Number(process.argv[2 + i] || d));
const OBS_LEN = 1012 * 34, ACTIONS = 46;

const core = await import(pathToFileURL(path.join(HERE, 'pkg', 'mortal_wasm_core.js')).href);
await core.default({ module_or_path: fs.readFileSync(path.join(HERE, 'pkg', 'mortal_wasm_core_bg.wasm')) });

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 4인 대국만 걸러서 이름순으로, 결정적으로 섞은 뒤 앞에서 calib, 그 다음 eval
const rnd = rng(42);
const files = fs.readdirSync(CACHE).filter(f => f.endsWith('.xml')).sort();
const games = [];
for (const f of files) {
  try { const g = parseMjlog(fs.readFileSync(path.join(CACHE, f), 'utf8')); if (g.names.length === 4) games.push({ id: f.replace('.xml', ''), g }); } catch { /* skip */ }
}
for (let i = games.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [games[i], games[j]] = [games[j], games[i]]; }
console.log('usable 4p games:', games.length);

function build(name, subset) {
  const meta = [];
  // 샘플을 메모리에 쌓지 않고 바로 파일에 이어 쓴다 (대용량 학습셋용)
  const fdObs = fs.openSync(path.join(OUT, `${name}.obs.f32`), 'w'), fdMask = fs.openSync(path.join(OUT, `${name}.mask.u8`), 'w');
  const r = rng(name === 'calib' ? 1 : name === 'eval' ? 2 : 3);
  for (const { id, g } of subset) {
    const { events } = toMjai(g);
    // 1차: 행동 가능 시점 수를 세어 이 대국에서 PER개 정도 뽑을 확률 p를 정한다
    const counts = [];
    let total = 0;
    for (let seat = 0; seat < 4; seat++) {
      const lines = viewFor(events, seat);
      const s = new core.Session(seat);
      let c = 0;
      for (const l of lines) if (s.update(l, true)) c++;
      s.free(); counts.push(c); total += c;
    }
    const p = Math.min(1, PER / Math.max(1, total));
    for (let seat = 0; seat < 4; seat++) {
      const lines = viewFor(events, seat);
      const s = new core.Session(seat);
      for (let i = 0; i < lines.length; i++) {
        if (!s.update(lines[i], true)) continue;
        if (r() >= p) continue;
        const enc = s.encode(false);
        fs.writeSync(fdObs, Buffer.from(enc.buffer, enc.byteOffset, OBS_LEN * 4));
        fs.writeSync(fdMask, Buffer.from(Uint8Array.from(enc.subarray(OBS_LEN), v => (v ? 1 : 0))));
        meta.push({ id, seat, idx: i });
      }
      s.free();
    }
  }
  fs.closeSync(fdObs); fs.closeSync(fdMask);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ n: meta.length, obsShape: [1012, 34], actions: ACTIONS, games: subset.map(x => x.id), samples: meta }));
  console.log(`${name}: games=${subset.length} samples=${meta.length} obs=${(meta.length * OBS_LEN * 4 / 1e6).toFixed(0)}MB`);
}

if (TRAIN_ONLY) {
  // 캐시가 늘어도 누수가 없도록, 이미 기록된 calib/eval 대국 ID를 직접 제외한다
  const used = new Set(['calib', 'eval'].flatMap(n => JSON.parse(fs.readFileSync(path.join(OUT, n + '.json'), 'utf8')).games));
  const rest = games.filter(x => !used.has(x.id));
  console.log(`excluded ${used.size} calib/eval games, train pool ${rest.length}`);
  build('train', rest);
}
else { build('calib', games.slice(0, NC)); build('eval', games.slice(NC, NC + NE)); }
