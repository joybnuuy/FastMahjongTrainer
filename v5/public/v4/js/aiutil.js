import { isRed } from './mjlog.js';
// Mortal 출력(Q값) 해석 — 브라우저/Node 공용
// 행동 인덱스: 0-33 타패, 34-36 적5(만/통/삭) 타패, 37 리치, 38-40 치, 41 퐁, 42 깡, 43 화료, 44 구종구패, 45 패스

export function decodeQ(mask, q) {
  const out = [];
  let k = 0;
  const m = BigInt(mask);
  for (let a = 0; a < 46; a++) if ((m >> BigInt(a)) & 1n) out.push({ a, q: q[k++] });
  return out;
}

export function softmax(qs, T = 1) {
  const m = Math.max(...qs);
  const e = qs.map(q => Math.exp((q - m) / T));
  const s = e.reduce((x, y) => x + y, 0);
  return e.map(x => x / s);
}

const RED = { 34: 4, 35: 13, 36: 22 };
export const discardKind = a => (a <= 33 ? a : RED[a] ?? -1);

// 한 판단 지점 → 타패 종류별 {kind, v(가치), p(선택확률), red}
// 리치 가능하면 리치 후 타패 분포를 합쳐서 "그 패를 버릴 때의 최선 가치/확률"로 병합
// hand(패 id 목록)를 주면, 같은 종류의 적도라와 일반패를 둘 다 들고 있는 경우 Mortal 이 둘을 다른 행동으로 보므로
// 종류 하나를 두 항목(split:true, red:false/true)으로 나눠 각각의 Q값·확률을 쓴다.
export function buildOptions(pt, hand = null) {
  const acts = decodeQ(pt.mask, pt.q);
  const probs = softmax(acts.map(x => x.q));
  const top = acts.reduce((b, x) => (x.q > b.q ? x : b));
  if ([42, 43, 44].includes(top.a)) return null; // 깡/화료/구종구패가 최선인 지점은 제외
  const map = new Map();
  const get = k => { if (!map.has(k)) map.set(k, { kind: k, v: -Infinity, p: 0, red: false, dama: -Infinity, vars: { n: { v: -Infinity, p: 0 }, r: { v: -Infinity, p: 0 } } }); return map.get(k); };
  const bump = (o, a, q, p) => { const s = a >= 34 ? o.vars.r : o.vars.n; s.p += p; if (q > s.v) s.v = q; };
  let pReach = 0;
  acts.forEach((x, i) => {
    if (x.a === 37) { pReach = probs[i]; return; }
    const k = discardKind(x.a);
    if (k < 0) return;
    const o = get(k);
    o.p += probs[i];
    bump(o, x.a, x.q, probs[i]);
    if (x.q > o.dama) { o.dama = x.q; o.red = x.a >= 34; }
    o.v = Math.max(o.v, x.q);
  });
  if (pt.reach && pReach > 0) {
    const ra = decodeQ(pt.reach.mask, pt.reach.q);
    const rp = softmax(ra.map(x => x.q));
    ra.forEach((x, i) => {
      const k = discardKind(x.a);
      if (k < 0) return;
      const o = get(k);
      o.p += pReach * rp[i];
      bump(o, x.a, x.q, pReach * rp[i]);
      o.reachV = x.q;
      o.v = Math.max(o.v, x.q);
      if (x.q >= (o.dama ?? -Infinity)) o.red = x.a >= 34;
    });
  }
  let opts = [...map.values()];
  if (hand) {
    const both = k => hand.some(t => t >> 2 === k && isRed(t)) && hand.some(t => t >> 2 === k && !isRed(t));
    opts = opts.flatMap(o => {
      if (!(both(o.kind) && o.vars.n.v > -Infinity && o.vars.r.v > -Infinity)) return [o];
      return [{ ...o, split: true, red: false, v: o.vars.n.v, p: o.vars.n.p }, { ...o, split: true, red: true, v: o.vars.r.v, p: o.vars.r.p }];
    });
  }
  opts.sort((a, b) => b.v - a.v);
  opts.forEach((o, i) => { o.gap = opts[0].v - o.v; o.rank = i; });
  return { opts, pReach, topIsReach: top.a === 37 };
}

// 사용자가 고른 패(kind, red)에 해당하는 항목. 적도라/일반패가 나뉜 종류는 red 까지 맞는 항목, 아니면 종류만 맞는 항목.
export const findOpt = (opts, kind, red) => opts.find(o => o.kind === kind && (!o.split || o.red === !!red)) ?? opts.find(o => o.kind === kind);

// ◎ 최선(또는 격차 0.1 이내) / ○ 허용(격차 0.7 이내 ≈ 확률 1순위의 절반 이상) / × 그 외
export function gradeAi(opts, kind, red) {
  const o = findOpt(opts, kind, red);
  if (o.gap <= 0.1) return 'best';
  if (o.gap <= 0.7) return 'ok';
  return 'bad';
}
