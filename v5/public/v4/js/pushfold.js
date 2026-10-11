// 푸시/풀 EV 모델 (리치에 대해 내 패를 어떻게 처리할지)
//   EV_밀기(d)  = 내 기대득점(d) − P(방총; d 이후 남은 진행 포함) × 평균 방총 손실
//   EV_접기(d)  = − P(방총; d + 약간의 잔여 위험) × 평균 방총 손실
//  방총확률 est는 로그 실측으로 보정한 표(danger.js)에서, 평균 손실은 로그 통계(STATS)에서 가져온다.
import { evaluateDiscards } from './ev.js';
import { STATS } from './dangerTable.js';

export const PUSH_HORIZON = 5;   // 내 화료를 기대하는 순수 (리치자가 먼저 화료/유국되는 것을 거칠게 반영한 상수)
export const FOLD_FUTURE = 0.02; // 접는 동안 이후 순목에서 맞을 잔여 위험 (거친 상수)
// Mortal의 접기/밀기에 맞춰 보정한 배율 (test/pushfold-tune.js)
export const PUSH_PARAMS = { lossScale: 1.5, futureMult: 3 };

const costOf = dealer => (dealer ? STATS?.avgDealInToRiichi?.dealer : STATS?.avgDealInToRiichi?.child) ?? (dealer ? 8200 : 5500);
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0.03; };

// q: def 문제 (opts: {kind, est, sh, ...}, riichers: [{dealer}], hand/view/unseen)
export function pushFold(q, extraKinds = []) {
  const v = q.view, me = v.me;
  const C = PUSH_PARAMS.lossScale * q.riichers.reduce((a, r) => a + costOf(r.dealer), 0) / q.riichers.length;
  const byEst = [...q.opts].sort((a, b) => a.est - b.est);
  const best = q.opts[0];
  const include = new Set([best.kind, byEst[0].kind, byEst[1]?.kind, ...extraKinds].filter(k => k != null));
  const rows = evaluateDiscards(q.hand, {
    melds: v.melds[me], dora: v.dora, unseen: q.unseen, roundWind: 27 + (v.kyoku >= 4 ? 1 : 0),
    seatWind: 27 + ((me - v.oya + 4) % 4), dealer: me === v.oya, wall: v.wall, horizon: PUSH_HORIZON,
  }, { include: [...include], max: 3 });
  const optOf = k => q.opts.find(o => o.kind === k);
  const out = rows.map(r => {
    const o = optOf(r.kind); if (!o) return null;
    const others = q.opts.filter(x => x.kind !== r.kind && x.est > 0.003).map(x => x.est);
    const pbar = Math.min(0.5, median(others) * PUSH_PARAMS.futureMult);
    const n = Math.max(0, r.sh);
    const dealinPush = 1 - (1 - o.est) * Math.pow(1 - pbar, n);
    const dealinFold = 1 - (1 - o.est) * (1 - FOLD_FUTURE * PUSH_PARAMS.futureMult);
    return { kind: r.kind, sh: r.sh, est: o.est, p: r.p, ev: r.ev, pbar, dealinPush, dealinFold, evPush: r.ev - dealinPush * C, evFold: -dealinFold * C };
  }).filter(Boolean);
  const bestPush = out.reduce((a, b) => (b.evPush > a.evPush ? b : a));
  const bestFold = out.reduce((a, b) => (b.evFold > a.evFold ? b : a));
  return { C, rows: out, bestPush, bestFold, recommend: bestPush.evPush > bestFold.evFold ? 'push' : 'fold' };
}

// Mortal의 1순위가 접기인지 밀기인지 (가장 안전한 패 대비 추정 방총률 차이)
export function mortalMode(q) {
  const safest = Math.min(...q.opts.map(o => o.est));
  return q.opts[0].est - safest <= 0.01 ? 'fold' : 'push';
}
