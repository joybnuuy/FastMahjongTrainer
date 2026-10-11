// Mortal 1순위 vs 실제 봉황방 플레이어의 타패 일치율 — mjai 변환/마스킹이 맞는지 검증
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMjlog } from '../public/js/mjlog.js';
import { toMjai } from '../public/js/mjai.js';
import { MortalWorker, decodeQ } from '../ai/client.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml')).slice(0, Number(process.argv[2]) || 2);
const w = new MortalWorker();
const kindOfAction = a => (a <= 33 ? a : a === 34 ? 4 : a === 35 ? 13 : a === 36 ? 22 : -1);
const kindOfStr = s => { // mjai 패 문자열 → kind
  const H = 'ESWNPFC'.indexOf(s); if (H >= 0) return 27 + H;
  return (s[0] - 1) + 9 * 'mps'.indexOf(s[1]);
};
let n = 0, agree = 0, reachN = 0, reachAgree = 0, ms = 0;
for (const f of files) {
  const game = parseMjlog(fs.readFileSync(path.join(dir, f), 'utf8'));
  const { events } = toMjai(game);
  const reqs = [], truth = {};
  events.forEach((ev, i) => {
    if (ev.type !== 'tsumo') return;
    for (let j = i + 1; j < events.length; j++) {
      const e = events[j];
      if (e.actor !== ev.actor && !['dora', 'reach_accepted'].includes(e.type)) break;
      if (e.type === 'dahai' && e.actor === ev.actor) { truth[i] = { kind: kindOfStr(e.pai), reach: events[j - 1].type === 'reach' }; reqs.push({ seat: ev.actor, idx: i }); break; }
      if (e.type === 'reach' || e.type === 'ankan' || e.type === 'kakan' || e.type === 'hora') break;
    }
  });
  const t0 = Date.now();
  const res = await w.analyze(events, reqs);
  ms += Date.now() - t0;
  for (const r of res) {
    const acts = decodeQ(r.mask, r.q).sort((a, b) => b.q - a.q);
    const best = acts[0].a, t = truth[r.idx];
    n++;
    if (t.reach) { reachN++; if (best === 37) reachAgree++; }
    if (kindOfAction(best) === t.kind && !t.reach) agree++;
    else if (t.reach && best === 37) agree++;
  }
  console.log(f, 'requests', reqs.length);
}
console.log(`일치율 ${(100 * agree / n).toFixed(1)}% (${agree}/${n}), 리치 선언 일치 ${reachAgree}/${reachN}, 분석 ${ms}ms`);
w.stop();
