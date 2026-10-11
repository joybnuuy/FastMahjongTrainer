// 리치 상대에 대한 방총 위험도 휴리스틱 + 실제 론 판정(로그는 상대 패가 보임)
import { countsOf, waits } from './engine.js';
import { doraKind } from './mjlog.js';

// 리치자 r에 대한 정보: 실제 대기, 현물(론 불가) 종류, 실제 론 가능 종류
export function riichiInfo(st, r) {
  const closed = countsOf(st.hands[r]);
  const w = waits(closed, st.melds[r].length);
  const safe = new Set();
  for (const e of st.rivers[r]) safe.add(e.tile >> 2);
  const after = st.riichi[r].seq;
  for (const d of st.discards) if (d.seq > after) safe.add(d.tile >> 2);
  const furiten = w.some(k => safe.has(k));
  return { r, waits: w, safe, furiten, ron: new Set(furiten ? [] : w) };
}

const W_SIDE = 0.036, W_KAN = 0.022, W_PEN = 0.006, W_SHAN = 0.016;

// 한 리치자에 대한 위험도 {p, tags}
function dangerOne(kind, vis, info, ctx) {
  const tags = [];
  if (info.safe.has(kind)) return { p: 0, tags: ['현물'] };
  const unseen = 4 - vis[kind];
  let p = 0;
  if (kind >= 27) {
    p = unseen >= 3 ? 0.055 : unseen === 2 ? 0.035 : unseen === 1 ? 0.018 : 0;
    if (unseen <= 1) tags.push(unseen === 0 ? '4장 소진' : '남은 1장');
    else if (unseen === 2) tags.push('남은 2장');
    if (kind >= 31 || kind === ctx.roundWind || kind === ctx.seatWinds[info.r]) { p *= 1.3; tags.push('역패'); }
  } else {
    const r = kind % 9, base = kind - r; // r: 0..8
    const has = d => (r + d >= 0 && r + d <= 8) ? base + r + d : -1;
    const dead = ks => ks.some(k => vis[k] >= 4);
    const one = ks => ks.some(k => vis[k] === 3);
    let sujiL = false, sujiR = false, kabe = false;
    const side = (a, b, outer) => { // 량면 한쪽: 필요한 두 장 a,b / 반대편 끝 outer
      if (a < 0 || b < 0) return 0;
      let w = W_SIDE;
      if (outer >= 0 && info.safe.has(outer)) { return 0; }
      if (dead([a, b])) { kabe = true; return 0; }
      if (one([a, b])) { kabe = true; w *= 0.4; }
      return w;
    };
    const l = side(has(-2), has(-1), has(-3));
    const rr = side(has(1), has(2), has(3));
    if (has(-2) >= 0 && has(-1) >= 0 && has(-3) >= 0 && info.safe.has(has(-3))) sujiL = true;
    if (has(1) >= 0 && has(2) >= 0 && has(3) >= 0 && info.safe.has(has(3))) sujiR = true;
    // 스지 판정은 실제 적용 가능한 쪽(량면이 존재하는 쪽) 기준
    const sides = (has(-2) >= 0 && has(-1) >= 0 ? 1 : 0) + (has(1) >= 0 && has(2) >= 0 ? 1 : 0);
    const sujiCnt = (sujiL ? 1 : 0) + (sujiR ? 1 : 0);
    if (sujiCnt && sujiCnt === sides) tags.push(sides === 2 ? '양스지' : '스지');
    else if (sujiCnt) tags.push('편스지');
    let kan = 0;
    if (has(-1) >= 0 && has(1) >= 0) {
      kan = W_KAN;
      if (dead([has(-1), has(1)])) { kan = 0; kabe = true; } else if (one([has(-1), has(1)])) { kan *= 0.4; kabe = true; }
    }
    const pen = (r === 2 || r === 6) ? W_PEN : 0;
    const sh = unseen <= 0 ? 0 : unseen === 1 ? W_SHAN * 0.4 : W_SHAN;
    p = l + rr + kan + pen + sh;
    if (kabe) tags.push('벽');
    if (unseen <= 1) tags.push('남은 ' + unseen + '장');
    if (r === 4) p *= 1.05;
  }
  if (ctx.doraKinds.has(kind)) { p *= 1.3; tags.push('도라'); }
  return { p, tags };
}

// 여러 리치자 합산 위험도
export function dangerOf(kind, vis, infos, ctx) {
  let safe = 1; const tags = [];
  for (const info of infos) {
    const d = dangerOne(kind, vis, info, ctx);
    safe *= 1 - d.p;
    for (const t of d.tags) { const s = infos.length > 1 ? info.label + ":" + t : t; if (!tags.includes(s)) tags.push(s); }
  }
  return { p: 1 - safe, tags };
}

export function makeCtx(st) {
  return {
    roundWind: 27 + (st.kyoku >= 4 ? 1 : 0),
    seatWinds: [0, 1, 2, 3].map(p => 27 + ((p - st.oya + 4) % 4)),
    doraKinds: new Set(st.dora.map(doraKind)),
  };
}
