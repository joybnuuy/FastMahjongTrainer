// 이론 기반 손패 분석: 블록 분해, 유효패 상세, 대기 모양, 역/타점 요소. (전부 결정적 계산)
import { shanten, ukeire } from './engine.js';

const isSuit = k => k < 27;
const rank = k => k % 9;
const isYaochu = k => k >= 27 || rank(k) === 0 || rank(k) === 8;

// ---------- 손패 분해 ----------
// 탈쯔 모양: a<b (같은 수트)
export function taatsuShape(a, b) {
  if (a === b) return 'pair';
  const d = b - a;
  if (d === 1) return (rank(a) === 0 || rank(b) === 8) ? 'penchan' : 'ryanmen';
  return 'kanchan'; // d === 2
}
const SHAPE_Q = { ryanmen: 3, pair: 2.6, kanchan: 2, penchan: 1.5 };

// 최선의 분해 (샨텐 최소 → 블록 품질 최대). c: 34칸 카운트(13장 또는 14장), melds: 후로 수
// 반환: {shanten, kind:'regular'|'chiitoi', mentsu:[[k,k,k]], taatsu:[{k:[a,b], shape}], pair:k|null, isolated:[k]}
export function decompose(c0, melds = 0) {
  const c = c0.slice();
  let best = null;
  const mentsu = [], taatsu = [];
  function leaf(pair) {
    const iso = [];
    for (let k = 0; k < 34; k++) for (let n = 0; n < c[k]; n++) iso.push(k);
    const m = melds + mentsu.length;
    const tt = m + taatsu.length > 4 ? 4 - m : taatsu.length;
    const s = 8 - 2 * m - tt - (pair != null ? 1 : 0);
    const q = mentsu.length * 10 + taatsu.reduce((x, t) => x + SHAPE_Q[t.shape], 0) - iso.length * 0.1;
    if (!best || s < best.shanten || (s === best.shanten && q > best.q)) {
      best = { shanten: s, q, kind: 'regular', mentsu: mentsu.map(x => x.slice()), taatsu: taatsu.map(t => ({ k: t.k.slice(), shape: t.shape })), pair, isolated: iso };
    }
  }
  function dfs(i, pair) {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) return leaf(pair);
    const suit = isSuit(i), r = rank(i);
    if (c[i] >= 3) { c[i] -= 3; mentsu.push([i, i, i]); dfs(i, pair); mentsu.pop(); c[i] += 3; }
    if (suit && r <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; mentsu.push([i, i + 1, i + 2]); dfs(i, pair); mentsu.pop(); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (pair == null) dfs(i, i);
      taatsu.push({ k: [i, i], shape: 'pair' }); dfs(i, pair); taatsu.pop();
      c[i] += 2;
    }
    if (suit && r <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; taatsu.push({ k: [i, i + 1], shape: taatsuShape(i, i + 1) }); dfs(i, pair); taatsu.pop(); c[i]++; c[i + 1]++; }
    if (suit && r <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; taatsu.push({ k: [i, i + 2], shape: 'kanchan' }); dfs(i, pair); taatsu.pop(); c[i]++; c[i + 2]++; }
    c[i]--; dfs(i, pair); c[i]++;
  }
  dfs(0, null);
  if (melds === 0) { // 치또이가 더 가깝다면 그 형태로 설명
    let pairs = 0, kinds = 0;
    for (let k = 0; k < 34; k++) { if (c0[k] >= 2) pairs++; if (c0[k] >= 1) kinds++; }
    const cs = 6 - pairs + Math.max(0, 7 - kinds);
    if (cs < best.shanten) {
      const pk = [], iso = [];
      for (let k = 0; k < 34; k++) { if (c0[k] >= 2) pk.push(k); for (let n = c0[k] >= 2 ? 2 : 0; n < c0[k]; n++) iso.push(k); if (c0[k] === 1) { /* 고립 */ } }
      const iso2 = []; for (let k = 0; k < 34; k++) { if (c0[k] === 1) iso2.push(k); else if (c0[k] > 2) for (let n = 2; n < c0[k]; n++) iso2.push(k); }
      return { shanten: cs, kind: 'chiitoi', mentsu: [], taatsu: pk.map(k => ({ k: [k, k], shape: 'pair' })), pair: null, isolated: iso2 };
    }
  }
  return best;
}

export const SHAPE_NAME = { ryanmen: '량면', kanchan: '간짱', penchan: '변짱', pair: '또이츠' };
export function shapeCounts(d) {
  const n = { ryanmen: 0, kanchan: 0, penchan: 0, pair: 0 };
  for (const t of d.taatsu) n[t.shape]++;
  return { mentsu: d.mentsu.length, ...n, head: d.pair != null ? 1 : 0, isolated: d.isolated.length };
}

// ---------- 유효패 상세 ----------
// 13장 상태에서 샨텐을 줄이는 패 목록 [{k,n}] (n 내림차순) + 합계
export function ukeireDetail(c13, melds, unseen) {
  const u = ukeire(c13.slice(), melds, unseen);
  const kinds = u.kinds.slice().sort((a, b) => b.n - a.n || a.k - b.k);
  return { total: u.total, kinds };
}

// ---------- 대기 모양 ----------
// 13장 텐파이 손패에서 대기패별 모양 {kind: Set('ryanmen'|'kanchan'|'penchan'|'shanpon'|'tanki'|'chiitoi'|'kokushi')}
export function waitShapes(c13, melds = 0) {
  const out = {};
  const need = 4 - melds;
  const add = (k, s) => { (out[k] ||= new Set()).add(s); };
  for (let w = 0; w < 34; w++) {
    if (c13[w] >= 4) continue;
    const c = c13.slice(); c[w]++;
    if (shanten(c, melds) !== -1) continue;
    let found = false;
    const sets = [];
    const walk = (i, pair) => {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) {
        if (pair == null || sets.length !== need) return;
        found = true;
        for (const s of sets) { // w를 포함한 블록에서 모양 판정
          if (s.t === 'seq' && s.k.includes(w)) {
            const r0 = rank(s.k[0]);
            const pos = s.k.indexOf(w);
            if (pos === 1) add(w, 'kanchan');
            else if (pos === 0) add(w, r0 === 6 ? 'penchan' : 'ryanmen');
            else add(w, r0 === 0 ? 'penchan' : 'ryanmen');
          } else if (s.t === 'tri' && s.k === w) add(w, 'shanpon');
        }
        if (pair === w) add(w, 'tanki');
        return;
      }
      const suit = isSuit(i), r = rank(i);
      if (c[i] >= 3) { c[i] -= 3; sets.push({ t: 'tri', k: i }); walk(i, pair); sets.pop(); c[i] += 3; }
      if (suit && r <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ t: 'seq', k: [i, i + 1, i + 2] }); walk(i, pair); sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++; }
      if (c[i] >= 2 && pair == null) { c[i] -= 2; walk(i, i); c[i] += 2; }
    };
    walk(0, null);
    if (!found) add(w, melds === 0 && c13.filter(x => x >= 2).length >= 6 ? 'chiitoi' : 'kokushi');
  }
  return out;
}
export const WAIT_NAME = { ryanmen: '량면', kanchan: '간짱', penchan: '변짱', shanpon: '샤보', tanki: '단기', chiitoi: '치또이', kokushi: '국사무쌍' };

// ---------- 역/타점 요소 ----------
// ids: 손패 패 id 배열(멘젠 부분), meldTiles: 후로 패 id 배열
export function valueHints(ids, meldTiles, ctx) {
  const all = ids.concat(meldTiles);
  const kinds = all.map(t => t >> 2);
  const dora = kinds.filter(k => ctx.doraKinds.has(k)).length + all.filter(t => t === 16 || t === 52 || t === 88).length;
  const yaochu = kinds.filter(isYaochu).length;
  const suitCnt = [0, 0, 0]; let honors = 0;
  for (const k of kinds) { if (k >= 27) honors++; else suitCnt[Math.floor(k / 9)]++; }
  const main = suitCnt.indexOf(Math.max(...suitCnt));
  const offSuit = suitCnt.reduce((a, b) => a + b, 0) - suitCnt[main];
  const cnt = new Array(34).fill(0); for (const k of kinds) cnt[k]++;
  const yakuhai = [];
  for (let k = 27; k < 34; k++) {
    const isY = k >= 31 || k === ctx.roundWind || k === ctx.seatWind;
    if (isY && cnt[k] >= 2) yakuhai.push({ k, n: cnt[k] });
  }
  return { dora, yaochu, tanyao: yaochu === 0, yakuhai, mainSuit: main, offSuit, honors, honitsu: offSuit <= 2 && honors + suitCnt[main] >= 8 };
}
