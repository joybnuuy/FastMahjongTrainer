// 스모크 테스트: 엔진 샨텐 값 + 실제 로그 시뮬레이션 검증(화료 패가 실제로 완성형인지)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shanten, countsOf, waits } from '../public/js/engine.js';
import { parseMjlog, replayRound } from '../public/js/mjlog.js';
import { generate } from '../public/js/gen.js';

const T = s => { // "123m456p789s11z" → counts
  const c = new Array(34).fill(0); let buf = [];
  for (const ch of s) {
    if ('mpsz'.includes(ch)) { for (const n of buf) c[{ m: 0, p: 9, s: 18, z: 27 }[ch] + n - 1]++; buf = []; } else buf.push(+ch);
  }
  return c;
};
let fail = 0;
const eq = (a, b, msg) => { if (a !== b) { fail++; console.log('FAIL', msg, a, '!=', b); } };

eq(shanten(T('123456789m11122p'), 0), -1, 'complete');
eq(shanten(T('1112345678999m'), 0), 0, 'nine gates tenpai');
eq(shanten(T('11223344556677m'), 0), -1, 'chiitoi complete');
eq(shanten(T('19m19p19s1234567z'), 0), 0, 'kokushi tenpai(13 distinct)');
eq(shanten(T('123m456p789s1122z'), 0), 0, 'tenpai 13');
eq(waits(T('123m456p789s1122z'), 0).join(), '27,28', 'shanpon wait');
eq(shanten(T('1m3m5m7m9m1p3p5p7p9p1s3s5s'), 0), 4, 'scattered');

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.xml')) : [];
let agariOk = 0, agariBad = 0;
for (const f of files) {
  const xml = fs.readFileSync(path.join(dir, f), 'utf8');
  const game = parseMjlog(xml);
  for (const round of game.rounds) {
    replayRound(round, {
      before(st, ev) {
        if (ev.t !== 'end' || ev.kind !== 'AGARI') return;
        const who = +ev.attrs.who, from = +ev.attrs.fromWho;
        const hand = st.hands[who].slice();
        if (who !== from) { const last = st.rivers[from].at(-1); hand.push(last.tile); }
        const s = shanten(countsOf(hand), st.melds[who].length);
        s === -1 ? agariOk++ : agariBad++;
      },
    });
  }
}
console.log(`agari 검증: ok=${agariOk} bad=${agariBad} (logs=${files.length})`);
if (agariBad) fail++;

if (files.length) {
  const t0 = Date.now();
  const out = generate(fs.readFileSync(path.join(dir, files[0]), 'utf8'), files[0]);
  console.log(`generate: eff=${out.eff.length} def=${out.def.length} tenpai=${out.tenpai.length} in ${Date.now() - t0}ms`);
}
console.log(fail ? `${fail} FAILED` : 'ALL OK');
process.exit(fail ? 1 : 0);
