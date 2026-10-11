// 화료 패의 역/부수/점수 계산 (일반 역 중심; 역만·일부 희귀 역은 제외)
// closed: 34칸 카운트(화료패 포함한 멘젠 부분), melds: [{type:'chi'|'pon'|'kan', kinds:[..], open:bool, kan:bool}]
// w: 화료패 종류, tsumo: bool, ctx: {roundWind, seatWind, dealer, riichi}
const isSuit = k => k < 27;
const rank = k => k % 9;
const yaochu = k => k >= 27 || rank(k) === 0 || rank(k) === 8;
const ceil100 = x => Math.ceil(x / 100) * 100;

export function pointsOf(han, fu, dealer) {
  let base;
  if (han >= 13) base = 8000; else if (han >= 11) base = 6000; else if (han >= 8) base = 4000; else if (han >= 6) base = 3000;
  else base = Math.min(2000, fu * Math.pow(2, han + 2));
  const ron = dealer ? ceil100(base * 6) : ceil100(base * 4);
  const tsumo = dealer ? 3 * ceil100(base * 2) : ceil100(base * 2) + 2 * ceil100(base);
  return { base, ron, tsumo };
}

function allDecomps(c, need) {
  const out = [], sets = [];
  const walk = (i, pair) => {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) { if (pair != null && sets.length === need) out.push({ sets: sets.map(s => ({ ...s })), pair }); return; }
    const suit = isSuit(i), r = rank(i);
    if (c[i] >= 3) { c[i] -= 3; sets.push({ t: 'tri', k: i }); walk(i, pair); sets.pop(); c[i] += 3; }
    if (suit && r <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ t: 'seq', k: i }); walk(i, pair); sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2 && pair == null) { c[i] -= 2; walk(i, i); c[i] += 2; }
  };
  walk(0, null);
  return out;
}

const kindsOfSet = s => s.t === 'seq' ? [s.k, s.k + 1, s.k + 2] : [s.k, s.k, s.k];

// 한 해석(분해 + 대기 해석)의 역/부수
function evaluate(dec, melds, w, tsumo, ctx, waitSet, waitType) {
  const sets = dec.sets.map((s, i) => ({ ...s, open: false, kan: false, wait: i === waitSet }));
  // 론으로 완성한 커쯔는 열린 것으로 취급
  if (!tsumo && waitSet >= 0 && sets[waitSet].t === 'tri') sets[waitSet].open = true;
  for (const m of melds) {
    if (m.type === 'chi') sets.push({ t: 'seq', k: Math.min(...m.kinds), open: true, kan: false });
    else sets.push({ t: 'tri', k: m.kinds[0], open: m.open, kan: !!m.kan });
  }
  const pair = dec.pair;
  const menzen = melds.every(m => !m.open);
  const seqs = sets.filter(s => s.t === 'seq'), tris = sets.filter(s => s.t === 'tri');
  const yaku = [];
  let han = 0;
  const add = (name, h) => { if (h > 0) { yaku.push(name); han += h; } };
  if (ctx.riichi && menzen) add('리치', 1);
  if (menzen && tsumo) add('멘젠쯔모', 1);
  const allKinds = []; for (const s of sets) allKinds.push(...kindsOfSet(s)); allKinds.push(pair, pair);
  if (allKinds.every(k => !yaochu(k))) add('탕야오', 1);
  // 역패
  let yakuhaiFu = 0;
  for (const t of tris) {
    if (t.k >= 31) add('역패(삼원)', 1);
    if (t.k === ctx.roundWind) add('역패(장풍)', 1);
    if (t.k === ctx.seatWind) add('역패(자풍)', 1);
  }
  const pairIsYakuhai = pair >= 31 ? 1 : (pair === ctx.roundWind ? 1 : 0) + (pair === ctx.seatWind ? 1 : 0);
  yakuhaiFu = pair >= 27 ? (pair >= 31 ? 2 : (pair === ctx.roundWind ? 2 : 0) + (pair === ctx.seatWind ? 2 : 0)) : 0;
  // 핑후
  const ryanmenWait = waitType === 'ryanmen';
  const pinfu = menzen && tris.length === 0 && ryanmenWait && !pairIsYakuhai;
  if (pinfu) add('핑후', 1);
  // 이페코
  if (menzen) {
    const cnt = {}; for (const s of seqs) cnt[s.k] = (cnt[s.k] || 0) + 1;
    const pairsOfSeq = Object.values(cnt).reduce((a, n) => a + Math.floor(n / 2), 0);
    if (pairsOfSeq >= 2) add('량페코', 3); else if (pairsOfSeq === 1) add('이페코', 1);
  }
  // 삼색동순 / 일기통관
  const seqSet = new Set(seqs.map(s => s.k));
  for (let r = 0; r < 7; r++) if (seqSet.has(r) && seqSet.has(9 + r) && seqSet.has(18 + r)) { add('삼색동순', menzen ? 2 : 1); break; }
  for (let s = 0; s < 3; s++) if (seqSet.has(s * 9) && seqSet.has(s * 9 + 3) && seqSet.has(s * 9 + 6)) { add('일기통관', menzen ? 2 : 1); break; }
  if (tris.length === 4) add('또이또이', 2);
  const closedTris = tris.filter(t => !t.open).length;
  if (closedTris >= 3) add('산안커', 2);
  if (tris.filter(t => t.kan).length >= 3) add('산깡쯔', 2);
  const triSet = new Set(tris.map(t => t.k));
  for (let r = 0; r < 9; r++) if (triSet.has(r) && triSet.has(9 + r) && triSet.has(18 + r)) { add('삼색동각', 2); break; }
  // 찬타 계열
  const groups = [...sets.map(s => kindsOfSet(s)), [pair, pair]];
  const hasYao = g => g.some(yaochu);
  if (groups.every(hasYao)) {
    const hasSeq = seqs.length > 0, hasHonor = allKinds.some(k => k >= 27);
    if (!hasSeq) add('혼노두', 2);
    else if (hasHonor) add('찬타', menzen ? 2 : 1);
    else add('준찬타', menzen ? 3 : 2);
  }
  // 소삼원
  const dragonTris = tris.filter(t => t.k >= 31).length;
  if (dragonTris === 2 && pair >= 31) add('소삼원', 2);
  // 혼일색/청일색
  const suitsUsed = new Set(allKinds.filter(isSuit).map(k => Math.floor(k / 9)));
  const hasHonorTile = allKinds.some(k => k >= 27);
  if (suitsUsed.size === 1) { if (hasHonorTile) add('혼일색', menzen ? 3 : 2); else add('청일색', menzen ? 6 : 5); }
  if (han === 0) return null; // 역 없음
  // 부수
  let fu;
  if (pinfu && tsumo) fu = 20;
  else {
    fu = 20;
    if (menzen && !tsumo) fu += 10;
    if (tsumo) fu += 2;
    fu += yakuhaiFu;
    for (const t of tris) {
      const yc = yaochu(t.k);
      fu += (t.kan ? 4 : 1) * (t.open ? 2 : 4) * (yc ? 2 : 1);
    }
    if (waitType === 'kanchan' || waitType === 'penchan' || waitType === 'tanki') fu += 2;
    fu = Math.ceil(fu / 10) * 10;
    if (!menzen && fu < 30) fu = 30;
  }
  return { han, fu, yaku };
}

function evalChiitoi(c, w, tsumo, ctx) {
  const kinds = []; for (let k = 0; k < 34; k++) if (c[k] === 2) kinds.push(k);
  if (kinds.length !== 7) return null;
  const yaku = ['치또이츠']; let han = 2;
  if (ctx.riichi) { han++; yaku.push('리치'); }
  if (tsumo) { han++; yaku.push('멘젠쯔모'); }
  if (kinds.every(k => !yaochu(k))) { han++; yaku.push('탕야오'); }
  const suits = new Set(kinds.filter(isSuit).map(k => Math.floor(k / 9)));
  if (suits.size === 1) { const honor = kinds.some(k => k >= 27); han += honor ? 3 : 6; yaku.push(honor ? '혼일색' : '청일색'); }
  if (kinds.every(yaochu)) { han += 2; yaku.push('혼노두'); }
  return { han, fu: 25, yaku };
}

// 최고 점수 해석 선택. dora: 도라 장수(적도라 포함)
export function bestScore(closed, melds, w, tsumo, ctx, dora = 0) {
  const need = 4 - melds.length;
  const decs = allDecomps(closed.slice(), need);
  let best = null;
  const consider = (r) => {
    if (!r) return;
    const han = r.han + dora;
    const p = pointsOf(han, r.fu, ctx.dealer);
    const pts = tsumo ? p.tsumo : p.ron;
    if (!best || pts > best.points) best = { han, fu: r.fu, yaku: r.yaku, points: pts, dora };
  };
  for (const dec of decs) {
    // 대기 해석: w를 포함하는 각 블록 / 머리
    for (let i = 0; i < dec.sets.length; i++) {
      const s = dec.sets[i];
      if (s.t === 'seq' && w >= s.k && w <= s.k + 2) {
        const pos = w - s.k;
        const wt = pos === 1 ? 'kanchan' : pos === 0 ? (rank(s.k) === 6 ? 'penchan' : 'ryanmen') : (rank(s.k) === 0 ? 'penchan' : 'ryanmen');
        consider(evaluate(dec, melds, w, tsumo, ctx, i, wt));
      } else if (s.t === 'tri' && s.k === w) consider(evaluate(dec, melds, w, tsumo, ctx, i, 'shanpon'));
    }
    if (dec.pair === w) consider(evaluate(dec, melds, w, tsumo, ctx, -1, 'tanki'));
  }
  if (melds.length === 0) consider(evalChiitoi(closed, w, tsumo, ctx));
  return best;
}
