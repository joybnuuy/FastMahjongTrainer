// 샨텐 / 우케이레 / 타패 효율 평가
// 패 종류(kind) 0-8 만, 9-17 통, 18-26 삭, 27-33 자패(東南西北白發中)

const memo = new Map();

export function countsOf(ids) {
  const c = new Array(34).fill(0);
  for (const id of ids) c[id >> 2]++;
  return c;
}

export function regularSlow(c, melds) {
  let best = 99;
  function dfs(i, m, t, p) {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      const tt = m + t > 4 ? 4 - m : t;
      const s = 8 - 2 * m - tt - p;
      if (s < best) best = s;
      return;
    }
    const suit = i < 27, r = i % 9;
    if (c[i] >= 3) { c[i] -= 3; dfs(i, m + 1, t, p); c[i] += 3; }
    if (suit && r <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; dfs(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!p) dfs(i, m, t, 1);
      dfs(i, m, t + 1, p);
      c[i] += 2;
    }
    if (suit && r <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; dfs(i, m, t + 1, p); c[i]++; c[i + 1]++; }
    if (suit && r <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; dfs(i, m, t + 1, p); c[i]++; c[i + 2]++; }
    c[i]--; dfs(i, m, t, p); c[i]++;
  }
  dfs(0, melds, 0, 0);
  return best;
}


// ---------- 빠른 샨텐: 수트별 패턴 표 캐시 + 합성 ----------
// 한 수트(9칸)의 패턴 → T[p][m] = (멘쯔 m개, 머리 p개일 때) 탈쯔 최대 수 (불가능하면 -1)
const suitCache = new Map();
function suitTable(a) {
  let key = 0; for (let i = 0; i < 9; i++) key = key * 5 + a[i];
  let tab = suitCache.get(key);
  if (tab) return tab;
  tab = [new Array(5).fill(-1), new Array(5).fill(-1)];
  const c = a.slice();
  const rec = (i, m, t, p) => {
    while (i < 9 && c[i] === 0) i++;
    if (i >= 9) { if (m <= 4 && t > tab[p][m]) tab[p][m] = t; return; }
    if (c[i] >= 3) { c[i] -= 3; rec(i, m + 1, t, p); c[i] += 3; }
    if (i <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; rec(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2) { c[i] -= 2; if (!p) rec(i, m, t, 1); rec(i, m, t + 1, p); c[i] += 2; }
    if (i <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; rec(i, m, t + 1, p); c[i]++; c[i + 1]++; }
    if (i <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; rec(i, m, t + 1, p); c[i]++; c[i + 2]++; }
    c[i]--; rec(i, m, t, p); c[i]++;
  };
  rec(0, 0, 0, 0);
  suitCache.set(key, tab);
  return tab;
}
function honorTable(c, off) {
  const tab = [new Array(5).fill(-1), new Array(5).fill(-1)];
  // dp[p][m] = max t, 7종을 순서대로
  let dp = [[0, -1, -1, -1, -1], [-1, -1, -1, -1, -1]];
  for (let k = 0; k < 7; k++) {
    const n = c[off + k];
    if (!n) continue;
    const nd = [new Array(5).fill(-1), new Array(5).fill(-1)];
    const put = (p, m, t) => { if (m <= 4 && t > nd[p][m]) nd[p][m] = t; };
    for (let p = 0; p < 2; p++) for (let m = 0; m < 5; m++) {
      const t = dp[p][m]; if (t < 0) continue;
      put(p, m, t); // 고립
      if (n >= 3) put(p, m + 1, t);
      if (n >= 2) { if (!p) put(1, m, t); put(p, m, t + 1); }
    }
    dp = nd;
  }
  return dp;
}
export function shantenRegularFast(c, melds) {
  for (let i = 0; i < 34; i++) if (c[i] < 0 || c[i] > 4) throw new Error('잘못된 패 개수: ' + c.join(''));
  const tabs = [suitTable(c.slice(0, 9)), suitTable(c.slice(9, 18)), suitTable(c.slice(18, 27)), honorTable(c, 27)];
  let dp = [new Array(5).fill(-1), new Array(5).fill(-1)];
  dp[0][Math.min(4, melds)] = 0;
  for (const tb of tabs) {
    const nd = [new Array(5).fill(-1), new Array(5).fill(-1)];
    for (let p = 0; p < 2; p++) for (let m = 0; m < 5; m++) {
      const t = dp[p][m]; if (t < 0) continue;
      for (let ps = 0; ps + p < 2; ps++) for (let ms = 0; ms + m < 5; ms++) {
        const ts = tb[ps][ms]; if (ts < 0) continue;
        if (t + ts > nd[p + ps][m + ms]) nd[p + ps][m + ms] = t + ts;
      }
    }
    dp = nd;
  }
  let best = 99;
  for (let p = 0; p < 2; p++) for (let m = 0; m < 5; m++) {
    const t = dp[p][m]; if (t < 0) continue;
    const tt = Math.min(t, 4 - m);
    const s = 8 - 2 * m - tt - p;
    if (s < best) best = s;
  }
  return best;
}

const TERMINALS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function shanten(c, melds = 0) {
  const key = melds + ':' + c.join('');
  let v = memo.get(key);
  if (v !== undefined) return v;
  v = shantenRegularFast(c, melds);
  if (melds === 0) {
    let pairs = 0, kinds = 0;
    for (let i = 0; i < 34; i++) { if (c[i] >= 2) pairs++; if (c[i] >= 1) kinds++; }
    v = Math.min(v, 6 - pairs + Math.max(0, 7 - kinds));
    let k = 0, hasPair = 0;
    for (const t of TERMINALS) { if (c[t] >= 1) k++; if (c[t] >= 2) hasPair = 1; }
    v = Math.min(v, 13 - k - hasPair);
  }
  if (memo.size > 400000) memo.clear();
  memo.set(key, v);
  return v;
}

// 13장(멘젠 부분) 텐파이 시 대기패 종류
export function waits(c, melds = 0) {
  const out = [];
  if (shanten(c, melds) !== 0) return out;
  for (let k = 0; k < 34; k++) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, melds) === -1) out.push(k);
    c[k]--;
  }
  return out;
}

// 13장 상태에서 샨텐을 줄이는 패 (unseen = 보이지 않은 남은 매수)
export function ukeire(c, melds, unseen) {
  const base = shanten(c, melds);
  let total = 0;
  const kinds = [];
  for (let k = 0; k < 34; k++) {
    if (unseen[k] <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, melds) < base) { total += unseen[k]; kinds.push({ k, n: unseen[k] }); }
    c[k]--;
  }
  return { total, kinds };
}

// 14장 중 최선의 타패 후 우케이레 (2수 후 잠재력 계산용)
function bestNext(c14, melds, unseen) {
  let minS = 99;
  const cand = [];
  for (let k = 0; k < 34; k++) {
    if (!c14[k]) continue;
    c14[k]--;
    const s = shanten(c14, melds);
    c14[k]++;
    if (s < minS) { minS = s; cand.length = 0; }
    if (s === minS) cand.push(k);
  }
  if (minS < 0) return 40; // 화료
  let best = 0;
  for (const k of cand) {
    c14[k]--;
    best = Math.max(best, ukeire(c14, melds, unseen).total);
    c14[k]++;
  }
  return best;
}

// 14장 손패에서 각 타패를 평가. 반환: 정렬된 옵션 (best 먼저)
// doraKinds: 도라 종류 집합, redCount: kind별 적도라 보유 여부
export function evalDiscards(c14, melds, unseen, doraKinds = new Set(), redKinds = new Set()) {
  const opts = [];
  for (let k = 0; k < 34; k++) {
    if (!c14[k]) continue;
    c14[k]--;
    opts.push({ kind: k, shanten: shanten(c14, melds) });
    c14[k]++;
  }
  const minS = Math.min(...opts.map(o => o.shanten));
  for (const o of opts) {
    if (o.shanten !== minS) { o.ue = 0; o.draws = []; continue; }
    c14[o.kind]--;
    const u = ukeire(c14, melds, unseen);
    o.ue = u.total; o.draws = u.kinds;
    c14[o.kind]++;
  }
  const top = opts.filter(o => o.shanten === minS);
  const maxUe = Math.max(...top.map(o => o.ue));
  const deep = top.filter(o => o.ue >= 0.7 * maxUe).sort((a, b) => b.ue - a.ue).slice(0, 4);
  for (const o of deep) {
    o.deep = true;
    if (minS <= 0) { o.next = o.ue; continue; } // 텐파이면 대기 매수가 전부
    c14[o.kind]--;
    let sum = 0, w = 0;
    for (const d of o.draws) {
      c14[d.k]++;
      unseen[d.k]--;
      sum += d.n * bestNext(c14, melds, unseen);
      unseen[d.k]++;
      c14[d.k]--;
      w += d.n;
    }
    c14[o.kind]++;
    o.next = w ? sum / w : 0;
  }
  for (const o of opts) {
    const val = (doraKinds.has(o.kind) ? 1 : 0) * 1.0 + (redKinds.has(o.kind) ? 1 : 0);
    o.score = o.deep ? 0.6 * o.ue + 0.4 * o.next - val : -1000 + o.ue - val;
    if (o.shanten !== minS) o.score = -2000 - o.shanten;
  }
  opts.sort((a, b) => a.shanten - b.shanten || b.score - a.score);
  opts.forEach((o, i) => (o.rank = i));
  return opts;
}

export function gradeEff(opts, kind) {
  const best = opts[0];
  const o = opts.find(x => x.kind === kind);
  if (o === best) return 'best';
  if (o.shanten === best.shanten && o.deep && o.score >= best.score - 0.8) return 'best';
  if (o.shanten === best.shanten && o.ue >= 0.9 * best.ue) return 'ok';
  return 'bad';
}
