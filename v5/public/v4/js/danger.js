// 리치 상대에 대한 방총 위험도 휴리스틱 + 실제 론 판정(로그는 상대 패가 보임)
// 각 위험도에는 사람이 읽을 수 있는 근거(why)가 구조화되어 따라온다.
import { countsOf, waits } from './engine.js';
import { doraKind } from './mjlog.js';
import { DANGER_TABLE } from './dangerTable.js';

// 리치자 r에 대한 정보: 실제 대기, 현물(론 불가) 종류, 실제 론 가능 종류
export function riichiInfo(st, r) {
  const closed = countsOf(st.hands[r]);
  const w = waits(closed, st.melds[r].length);
  const own = new Set(), passed = new Set();
  for (const e of st.rivers[r]) own.add(e.tile >> 2);
  const after = st.riichi[r].seq;
  for (const d of st.discards) if (d.seq > after) passed.add(d.tile >> 2);
  const safe = new Set([...own, ...passed]);
  const furiten = w.some(k => safe.has(k));
  const riichiTurn = st.rivers[r].findIndex(e => e.riichi) + 1; // 리치 선언 순목
  return { r, waits: w, safe, own, passed, furiten, ron: new Set(furiten ? [] : w), riichiTurn, dealer: r === st.oya, riverLen: st.rivers[r].length };
}

const W_SIDE = 0.036, W_KAN = 0.022, W_PEN = 0.006, W_SHAN = 0.016;

// 한 리치자에 대한 위험도 {p, tags, why}
//   why 항목: {t:'genbutsu', how:'river'|'passed'} {t:'suji', partners:[k], both:bool} {t:'kabe', kinds:[k], n:3|4}
//             {t:'honor', unseen} {t:'dead', ...} {t:'dora'} {t:'yakuhai'} {t:'nothing'}
export function dangerOneRaw(kind, vis, info, ctx) {
  const tags = [], why = [];
  if (info.safe.has(kind)) {
    why.push({ t: 'genbutsu', how: info.own.has(kind) ? 'river' : 'passed' });
    return { p: 0, tags: ['현물'], why };
  }
  const unseen = 4 - vis[kind];
  let p = 0;
  if (kind >= 27) {
    p = unseen >= 3 ? 0.055 : unseen === 2 ? 0.035 : unseen === 1 ? 0.018 : 0;
    why.push({ t: 'honor', unseen });
    if (unseen <= 1) tags.push(unseen === 0 ? '4장 소진' : '남은 1장');
    else if (unseen === 2) tags.push('남은 2장');
    if (kind >= 31 || kind === ctx.roundWind || kind === ctx.seatWinds[info.r]) { p *= 1.3; tags.push('역패'); why.push({ t: 'yakuhai' }); }
  } else {
    const r = kind % 9, base = kind - r;
    const has = d => (r + d >= 0 && r + d <= 8) ? base + r + d : -1;
    const dead = ks => ks.some(k => vis[k] >= 4);
    const one = ks => ks.some(k => vis[k] === 3);
    let kabe = false;
    const kabeKinds = new Set(); let kabeN = 4;
    const noteKabe = (ks) => { for (const k of ks) if (vis[k] >= 3) { kabeKinds.add(k); kabeN = Math.min(kabeN, vis[k]); } };
    const side = (a, b, outer) => {
      if (a < 0 || b < 0) return 0;
      let w = W_SIDE;
      if (outer >= 0 && info.safe.has(outer)) return 0;
      if (dead([a, b])) { kabe = true; noteKabe([a, b]); return 0; }
      if (one([a, b])) { kabe = true; noteKabe([a, b]); w *= 0.4; }
      return w;
    };
    const l = side(has(-2), has(-1), has(-3));
    const rr = side(has(1), has(2), has(3));
    const lValid = has(-2) >= 0 && has(-1) >= 0, rValid = has(1) >= 0 && has(2) >= 0;
    const sujiL = lValid && has(-3) >= 0 && info.safe.has(has(-3));
    const sujiR = rValid && has(3) >= 0 && info.safe.has(has(3));
    const sides = (lValid ? 1 : 0) + (rValid ? 1 : 0);
    const partners = [sujiL ? has(-3) : -1, sujiR ? has(3) : -1].filter(k => k >= 0);
    if (partners.length) {
      const full = partners.length === sides;
      tags.push(full ? (sides === 2 ? '양스지' : '스지') : '편스지');
      why.push({ t: 'suji', partners, both: full });
    }
    let kan = 0;
    if (has(-1) >= 0 && has(1) >= 0) {
      kan = W_KAN;
      if (dead([has(-1), has(1)])) { kan = 0; kabe = true; noteKabe([has(-1), has(1)]); } else if (one([has(-1), has(1)])) { kan *= 0.4; kabe = true; noteKabe([has(-1), has(1)]); }
    }
    const pen = (r === 2 || r === 6) ? W_PEN : 0;
    const sh = unseen <= 0 ? 0 : unseen === 1 ? W_SHAN * 0.4 : W_SHAN;
    p = l + rr + kan + pen + sh;
    if (kabe) { tags.push('벽'); why.push({ t: 'kabe', kinds: [...kabeKinds], n: kabeN }); }
    if (unseen <= 1) tags.push('남은 ' + unseen + '장');
    if (!partners.length && !kabe) why.push({ t: 'nothing', rank: r + 1 });
    if (r === 4) p *= 1.05;
  }
  if (ctx.doraKinds.has(kind)) { p *= 1.3; tags.push('도라'); why.push({ t: 'dora' }); }
  return { p, tags, why };
}


// ---------- 데이터 보정 ----------
// 특징 분류: 반환 [L0..L4 키] (정밀 → 대략) / 현물이면 null
export function classKeys(kind, vis, info, ctx) {
  if (info.safe.has(kind)) return null;
  const unseen = 4 - vis[kind];
  const dora = ctx.doraKinds.has(kind) ? 1 : 0;
  const len = info.riverLen < 8 ? 0 : info.riverLen < 13 ? 1 : 2;
  let tile, suji = '-', kabe = '-', u = '';
  if (kind >= 27) {
    const yk = (kind >= 31 || kind === ctx.roundWind || kind === ctx.seatWinds[info.r]) ? 1 : 0;
    tile = `H${Math.min(unseen, 3)}${yk}`;
  } else {
    const r = kind % 9, base = kind - r;
    const has = d => (r + d >= 0 && r + d <= 8) ? base + r + d : -1;
    tile = 'N' + Math.min(r, 8 - r);
    u = unseen <= 1 ? 'u1' : 'u0';
    const lValid = has(-2) >= 0 && has(-1) >= 0, rValid = has(1) >= 0 && has(2) >= 0;
    const sujiL = lValid && has(-3) >= 0 && info.safe.has(has(-3));
    const sujiR = rValid && has(3) >= 0 && info.safe.has(has(3));
    const sides = (lValid ? 1 : 0) + (rValid ? 1 : 0), elim = (sujiL ? 1 : 0) + (sujiR ? 1 : 0);
    suji = elim === 0 ? 'n' : elim === sides ? 'f' : 'h';
    let kb = 0;
    const chk = ks => { if (ks.some(k => vis[k] >= 4)) kb = Math.max(kb, 2); else if (ks.some(k => vis[k] === 3)) kb = Math.max(kb, 1); };
    if (lValid && !sujiL) chk([has(-2), has(-1)]);
    if (rValid && !sujiR) chk([has(1), has(2)]);
    if (has(-1) >= 0 && has(1) >= 0) chk([has(-1), has(1)]);
    kabe = String(kb);
  }
  return [
    `${tile}${u}|${suji}|${kabe}|${dora}|${len}`, // L0
    `${tile}${u}|${suji}|${kabe}|${dora}`,        // L1 (순목 제외)
    `${tile}${u}|${suji}|${kabe}`,                // L2 (도라 제외)
    `${tile}|${suji}|${kabe}`,                    // L3 (장수 제외)
    `${tile}`,                                    // L4
  ];
}

// 한 리치자에 대한 위험도: 보정 표가 있으면 표 값, 없으면 상수 모델
export function dangerOne(kind, vis, info, ctx) {
  const raw = dangerOneRaw(kind, vis, info, ctx);
  if (info.safe.has(kind)) return { ...raw, pRaw: raw.p, calibrated: false };
  const keys = classKeys(kind, vis, info, ctx);
  for (const k of keys) {
    const v = DANGER_TABLE[k];
    if (v !== undefined) return { ...raw, p: v, pRaw: raw.p, calibrated: true, key: k };
  }
  return { ...raw, pRaw: raw.p, calibrated: false };
}

// 여러 리치자 합산 위험도. whys: 리치자별 근거
export function dangerOf(kind, vis, infos, ctx) {
  let safe = 1; const tags = [], whys = [];
  for (const info of infos) {
    const d = dangerOne(kind, vis, info, ctx);
    safe *= 1 - d.p;
    whys.push({ label: info.label, r: info.r, p: d.p, why: d.why });
    for (const t of d.tags) { const s = infos.length > 1 ? info.label + ":" + t : t; if (!tags.includes(s)) tags.push(s); }
  }
  return { p: 1 - safe, tags, whys };
}

export function makeCtx(st) {
  return {
    roundWind: 27 + (st.kyoku >= 4 ? 1 : 0),
    seatWinds: [0, 1, 2, 3].map(p => 27 + ((p - st.oya + 4) % 4)),
    doraKinds: new Set(st.dora.map(doraKind)),
  };
}
