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
export function buildOptions(pt) {
  const acts = decodeQ(pt.mask, pt.q);
  const probs = softmax(acts.map(x => x.q));
  const top = acts.reduce((b, x) => (x.q > b.q ? x : b));
  if ([42, 43, 44].includes(top.a)) return null; // 깡/화료/구종구패가 최선인 지점은 제외
  const map = new Map();
  const get = k => { if (!map.has(k)) map.set(k, { kind: k, v: -Infinity, p: 0, red: false, dama: -Infinity }); return map.get(k); };
  let pReach = 0;
  acts.forEach((x, i) => {
    if (x.a === 37) { pReach = probs[i]; return; }
    const k = discardKind(x.a);
    if (k < 0) return;
    const o = get(k);
    o.p += probs[i];
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
      o.reachV = x.q;
      o.v = Math.max(o.v, x.q);
      if (x.q >= (o.dama ?? -Infinity)) o.red = x.a >= 34;
    });
  }
  const opts = [...map.values()].sort((a, b) => b.v - a.v);
  opts.forEach((o, i) => { o.gap = opts[0].v - o.v; o.rank = i; });
  return { opts, pReach, topIsReach: top.a === 37 };
}

// ◎ 최선(또는 격차 0.1 이내) / ○ 허용(격차 0.7 이내 ≈ 확률 1순위의 절반 이상) / × 그 외
export function gradeAi(opts, kind) {
  const o = opts.find(x => x.kind === kind);
  if (o.gap <= 0.1) return 'best';
  if (o.gap <= 0.7) return 'ok';
  return 'bad';
}
