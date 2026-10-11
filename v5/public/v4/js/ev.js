// 화료확률 + 기대 타점 DP (상대의 방해·방어는 고려하지 않는 '내 손 단독' 지표)
//  W(손패13, t) = t번의 내 쯔모 안에 화료할 확률 / 기대 득점. 매 쯔모에서 샨텐을 줄이는 패만 '진행'으로 보고
//  나머지는 쯔모기리(손패 유지)로 취급한다 — 모양 변화(好形変化)로 얻는 이득은 과소평가하는 하한 근사.
import { shanten, countsOf } from './engine.js';
import { bestScore } from './score.js';
import { doraKind } from './mjlog.js';
import { STATS } from './dangerTable.js';

const RON_RATIO = STATS?.ronRatio ?? 1.5; // 텐파이에서 론 화료 기회 ≈ 쯔모 기회의 몇 배 (로그 실측: 론 화료 수 / 쯔모 화료 수)
const isRed = id => id === 16 || id === 52 || id === 88;

export function makeEvCtx({ hand, melds, dora, unseen, roundWind, seatWind, dealer, wall, horizon }) {
  const doraKinds = new Set(dora.map(doraKind));
  const meldInfo = melds.map(m => ({
    type: m.type === 'chi' ? 'chi' : m.type === 'pon' ? 'pon' : 'kan',
    kinds: m.tiles.map(t => t >> 2).slice(0, m.type === 'chi' || m.type === 'pon' ? 3 : 4),
    open: m.type !== 'ankan', kan: m.type === 'daiminkan' || m.type === 'kakan' || m.type === 'ankan',
  }));
  const meldDora = melds.reduce((n, m) => n + m.tiles.filter(t => doraKinds.has(t >> 2) || isRed(t)).length, 0);
  const total = unseen.reduce((a, b) => a + Math.max(0, b), 0);
  return { doraKinds, meldInfo, meldDora, unseen, total, roundWind, seatWind, dealer, menzen: meldInfo.every(m => !m.open), nm: melds.length, T: horizon ?? Math.max(1, Math.min(8, Math.floor((wall ?? 40) / 4))) };
}

function scoreOf(ctx, redKeep, c14, w, tsumo) {
  let dora = ctx.meldDora;
  for (let k = 0; k < 34; k++) { if (!c14[k]) continue; if (ctx.doraKinds.has(k)) dora += c14[k]; if (redKeep[k]) dora++; }
  return bestScore(c14, ctx.meldInfo, w, tsumo, { roundWind: ctx.roundWind, seatWind: ctx.seatWind, dealer: ctx.dealer, riichi: ctx.menzen }, dora);
}

// 13장(멘젠부) 상태에서 시작: {p, ev}
export function solve(ctx, redKeep, c13, T = ctx.T) {
  const memo = new Map(), scMemo = new Map();
  let budget = 25000; // 탐색 상태 상한 — 초과하면 더 얕게 다시 계산
  const BUDGET_EXCEEDED = new Error('budget');
  const sc = (c14, w, tsumo) => {
    const key = c14.join('') + w + (tsumo ? 't' : 'r');
    let v = scMemo.get(key);
    if (v === undefined) { v = scoreOf(ctx, redKeep, c14, w, tsumo); scMemo.set(key, v); }
    return v;
  };
  const ukMemo = new Map();
  const ukOf = (c) => {
    const key = c.join('');
    let v = ukMemo.get(key);
    if (!v) {
      const base = shanten(c, ctx.nm), kinds = []; let tot = 0;
      for (let k = 0; k < 34; k++) {
        if (ctx.unseen[k] <= 0 || c[k] >= 4) continue;
        c[k]++; if (shanten(c, ctx.nm) < base) { kinds.push({ k, n: ctx.unseen[k] }); tot += ctx.unseen[k]; } c[k]--;
      }
      v = { s: base, kinds, tot }; ukMemo.set(key, v);
    }
    return v;
  };
  const ZERO = { p: 0, ev: 0 };
  function bestDiscard(c14, t) {
    // 샨텐이 최소인 타패 후보 중 우케이레 상위 4개만 탐색
    let minS = 99; const cands = [];
    for (let k = 0; k < 34; k++) {
      if (!c14[k]) continue;
      c14[k]--; const s = shanten(c14, ctx.nm); c14[k]++;
      if (s < minS) { minS = s; cands.length = 0; }
      if (s === minS) cands.push(k);
    }
    const keep = minS >= 3 ? 2 : minS === 2 ? 3 : 4; // 먼 손패일수록 후보를 줄인다
    const scored = cands.map(k => { c14[k]--; const u = ukOf(c14).tot; c14[k]++; return { k, u }; }).sort((a, b) => b.u - a.u).slice(0, keep);
    let best = ZERO;
    for (const { k } of scored) {
      c14[k]--; const r = W(c14, t); c14[k]++;
      if (r.ev > best.ev || (r.ev === best.ev && r.p > best.p)) best = r;
    }
    return best;
  }
  function W(c, t) {
    if (t <= 0) return ZERO;
    const key = c.join('') + '|' + t;
    const hit = memo.get(key); if (hit) return hit;
    if (--budget < 0) throw BUDGET_EXCEEDED;
    const uk = ukOf(c);
    let p = 0, ev = 0, used = 0;
    const draws = uk.s >= 3 && uk.kinds.length > 9 ? uk.kinds.slice().sort((a, b) => b.n - a.n).slice(0, 9) : uk.kinds;
    for (const { k, n } of draws) {
      const q = n / ctx.total;
      if (uk.s === 0) { // 텐파이: 쯔모 + 론 기회
        c[k]++;
        const st = sc(c, k, true), sr = sc(c, k, false);
        c[k]--;
        if (st || sr) {
          const pt = st ? q : 0, pr = sr ? q * RON_RATIO : 0;
          const pw = Math.min(1, pt + pr);
          p += pw; ev += (st ? pt * st.points : 0) + (sr ? pr * sr.points : 0);
          used += pw;
        }
      } else {
        c[k]++;
        const r = bestDiscard(c, t - 1);
        c[k]--;
        p += q * r.p; ev += q * r.ev; used += q;
      }
    }
    const idle = W(c, t - 1);
    const rest = Math.max(0, 1 - used);
    const out = { p: p + rest * idle.p, ev: ev + rest * idle.ev };
    memo.set(key, out);
    return out;
  }
  let tt = T;
  for (;;) {
    try { return W(c13, tt); } catch (e) { if (e !== BUDGET_EXCEEDED || tt <= 2) throw e; tt = Math.max(2, tt - 2); memo.clear(); budget = 25000; }
  }
}

// 14장 손패에서 타패 후보별 평가. 후보 = (샨텐 오름차순, 유효패 내림차순) 상위 max개 + include 종류
// 반환 [{kind, id, sh, p, ev}] (ev 내림차순)
export function evaluateDiscards(handIds, params, { include = [], max = 6 } = {}) {
  const ctx = makeEvCtx({ ...params, hand: handIds });
  const kinds = [...new Set(handIds.map(t => t >> 2))];
  const pre = kinds.map(kind => {
    const id = handIds.filter(t => t >> 2 === kind).sort((a, b) => isRed(a) - isRed(b))[0];
    const c = countsOf(handIds.filter(t => t !== id));
    const sh = shanten(c, ctx.nm);
    let u = 0;
    for (let k = 0; k < 34; k++) { if (ctx.unseen[k] <= 0 || c[k] >= 4) continue; c[k]++; if (shanten(c, ctx.nm) < sh) u += ctx.unseen[k]; c[k]--; }
    return { kind, id, sh, u };
  }).sort((a, b) => a.sh - b.sh || b.u - a.u);
  const chosen = new Set(pre.slice(0, max).map(x => x.kind));
  for (const k of include) chosen.add(k);
  const out = [];
  for (const o of pre) {
    if (!chosen.has(o.kind)) continue;
    const after = handIds.filter(t => t !== o.id);
    const redKeep = new Array(34).fill(0);
    for (const t of after) if (isRed(t)) redKeep[t >> 2] = 1;
    const r = solve(ctx, redKeep, countsOf(after));
    out.push({ kind: o.kind, id: o.id, sh: o.sh, ukeire: o.u, p: r.p, ev: r.ev });
  }
  return out.sort((a, b) => b.ev - a.ev);
}
