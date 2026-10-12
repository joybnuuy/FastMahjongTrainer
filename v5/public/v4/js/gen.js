// 로그 → 퀴즈 문제 생성
import { parseMjlog, replayRound, doraKind, visibleCounts, isRed } from './mjlog.js';
import { countsOf, shanten, waits, evalDiscards } from './engine.js';
import { riichiInfo, dangerOf, makeCtx } from './danger.js';
import { buildOptions } from './aiutil.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// UI에 넘길 공개 정보 스냅샷 (손패는 별도)
function publicView(st, me) {
  return {
    kyoku: st.kyoku, honba: st.honba, kyotaku: st.kyotaku, oya: st.oya, me,
    dora: st.dora.slice(), scores: st.scores.slice(), wall: st.wall,
    rivers: st.rivers.map(r => r.map(e => ({ tile: e.tile, called: e.called, riichi: e.riichi, tsumogiri: e.tsumogiri }))),
    melds: st.melds.map(ms => ms.map(m => ({ type: m.type, tiles: m.tiles.slice(), called: m.called, from: m.from }))),
    riichi: st.riichi.map(x => !!x),
  };
}

function gameMeta(game, id) { return { id, names: game.names, dan: game.dan }; }

// ① 타패 효율 문제
function effQuestion(st, ev, me, meta) {
  const hand = st.hands[me];
  const c14 = countsOf(hand);
  const nm = st.melds[me].length;
  const vis = visibleCounts(st, me);
  const unseen = vis.map(v => 4 - v);
  const dk = new Set(st.dora.map(doraKind));
  const reds = new Set(hand.filter(isRed).map(t => t >> 2));
  const opts = evalDiscards(c14, nm, unseen, dk, reds);
  if (opts[0].shanten < 0) return null; // 이미 화료
  const minS = opts[0].shanten;
  if (opts.filter(o => o.shanten === minS).length < 3) return null; // 너무 뻔한 문제 제외
  return {
    mode: 'eff', meta, view: publicView(st, me), hand: hand.slice(), drawn: st.drawn[me],
    actual: ev.tile >> 2, actualId: ev.tile, turn: st.rivers[me].length + 1, unseen,
    opts: opts.map(o => ({ kind: o.kind, shanten: o.shanten, ue: o.ue, draws: o.draws, next: o.next ?? null, rank: o.rank, deep: !!o.deep })),
  };
}

// ② 리치 방어 문제
function defQuestion(st, ev, me, meta) {
  const riichers = [0, 1, 2, 3].filter(p => p !== me && st.riichi[p]);
  if (!riichers.length) return null;
  const infos = riichers.map(r => ({ ...riichiInfo(st, r), label: ["나", "하가", "대면", "상가"][(r - me + 4) % 4] }));
  const hand = st.hands[me];
  const kinds = [...new Set(hand.map(t => t >> 2))];
  const ronKinds = new Set(infos.flatMap(i => [...i.ron]));
  if (!kinds.some(k => ronKinds.has(k))) return null; // 손에 론당할 패가 있는 경우만
  const c14 = countsOf(hand);
  const nm = st.melds[me].length;
  const vis = visibleCounts(st, me);
  const ctx = makeCtx(st);
  const opts = kinds.map(k => {
    const d = dangerOf(k, vis, infos, ctx);
    c14[k]--;
    const s = shanten(c14, nm);
    c14[k]++;
    return { kind: k, p: d.p, tags: d.tags, ron: ronKinds.has(k), shanten: s };
  });
  const minS = Math.min(...opts.map(o => o.shanten));
  if (minS < 2) return null; // 방어가 자연스러운 약한 손패만
  opts.sort((a, b) => a.p - b.p || a.shanten - b.shanten);
  const safeOpts = opts.filter(o => o.p <= opts[0].p + 0.004).length;
  if (safeOpts === opts.length) return null;
  return {
    mode: 'def', meta, view: publicView(st, me), hand: hand.slice(), drawn: st.drawn[me],
    actual: ev.tile >> 2, actualId: ev.tile, myShanten: minS,
    riichers: infos.map(i => ({ r: i.r, waits: i.waits, furiten: i.furiten, hand: st.hands[i.r].slice() })),
    opts,
  };
}

// ③ 텐파이 감 문제 (타패 직후 스냅샷)
function tenpaiQuestion(st, ev, me, meta) {
  const players = [];
  for (let p = 0; p < 4; p++) {
    if (p === me) continue;
    const c = countsOf(st.hands[p]);
    const w = waits(c, st.melds[p].length);
    players.push({ p, riichi: !!st.riichi[p], tenpai: shanten(c, st.melds[p].length) === 0, waits: w, hand: st.hands[p].slice() });
  }
  if (players.every(x => x.riichi)) return null;
  return {
    mode: 'tenpai', meta, view: publicView(st, me), hand: st.hands[me].slice(), unseen: visibleCounts(st, me).map(v => 4 - v),
    players,
    askedHasTenpai: players.some(x => !x.riichi && x.tenpai),
  };
}


// ---- 스타일 참고: 같은 지점에서 스타일 헤드가 낸 Q 로 만든 선택지 (참고 표시 전용, 채점에는 쓰지 않는다) ----
function styleViews(pt, hand, styleMeta) {
  if (!pt.styles) return null;
  const out = [];
  for (const [id, q] of Object.entries(pt.styles)) {
    const rq = pt.reach && pt.reach.styles && pt.reach.styles[id];
    const b = buildOptions({ mask: pt.mask, q, reach: rq ? { mask: pt.reach.mask, q: rq } : undefined }, hand);
    if (!b) continue;
    const m = (styleMeta || []).find(x => x.id === id) || {};
    out.push({ id, name: m.name || id, desc: m.desc || '', pReach: b.pReach, opts: b.opts.map(o => ({ kind: o.kind, red: o.red, split: !!o.split, gap: o.gap, p: o.p })) });
  }
  return out.length ? out : null;
}

// ---- Mortal 기반 문제 (pt = 서버가 계산한 해당 지점의 Q값) ----
function effQuestionAi(st, ev, me, meta, pt, styleMeta) {
  const built = buildOptions(pt, st.hands[me]);
  if (!built) return null;
  if (!built.opts.every(o => st.hands[me].some(t => t >> 2 === o.kind))) return null; // 캐시가 로그와 어긋난 경우 방어
  const hand = st.hands[me], c14 = countsOf(hand), nm = st.melds[me].length;
  const unseen = visibleCounts(st, me).map(v => 4 - v);
  const local = evalDiscards(c14, nm, unseen, new Set(st.dora.map(doraKind)), new Set(hand.filter(isRed).map(t => t >> 2)));
  const L = new Map(local.map(o => [o.kind, o]));
  const opts = built.opts.filter(o => L.has(o.kind)).map(o => ({ ...o, sh: L.get(o.kind).shanten, ue: L.get(o.kind).ue }));
  if (opts.length < 2) return null;
  const actual = ev.tile >> 2;
  if (opts[0].p >= 0.9 && opts[0].kind === actual) return null; // 너무 뻔한 문제 제외
  return {
    mode: 'eff', ai: true, meta, view: publicView(st, me), hand: hand.slice(), drawn: st.drawn[me],
    actual, actualId: ev.tile, actualRed: isRed(ev.tile), turn: st.rivers[me].length + 1, opts, pReach: built.pReach, unseen,
    styles: styleViews(pt, hand, styleMeta),
  };
}

function defQuestionAi(st, ev, me, meta, pt, styleMeta) {
  const built = buildOptions(pt, st.hands[me]);
  if (!built) return null;
  if (!built.opts.every(o => st.hands[me].some(t => t >> 2 === o.kind))) return null;
  const riichers = [0, 1, 2, 3].filter(p => p !== me && st.riichi[p]);
  if (!riichers.length) return null;
  const labels = ['나', '하가', '대면', '상가'];
  const infos = riichers.map(r => ({ ...riichiInfo(st, r), label: labels[(r - me + 4) % 4] }));
  const hand = st.hands[me];
  const ronKinds = new Set(infos.flatMap(i => [...i.ron]));
  if (!hand.some(t => ronKinds.has(t >> 2))) return null;
  const c14 = countsOf(hand), nm = st.melds[me].length;
  const vis = visibleCounts(st, me), ctx = makeCtx(st);
  const opts = built.opts.map(o => {
    const d = dangerOf(o.kind, vis, infos, ctx);
    c14[o.kind]--;
    const sh = shanten(c14, nm);
    c14[o.kind]++;
    return { ...o, est: d.p, tags: d.tags, whys: d.whys, ron: ronKinds.has(o.kind), sh };
  });
  return {
    mode: 'def', ai: true, meta, view: publicView(st, me), hand: hand.slice(), drawn: st.drawn[me],
    actual: ev.tile >> 2, actualId: ev.tile, actualRed: isRed(ev.tile), myShanten: Math.min(...opts.map(o => o.sh)), pReach: built.pReach,
    styles: styleViews(pt, hand, styleMeta),
    riichers: infos.map(i => ({ r: i.r, waits: i.waits, furiten: i.furiten, hand: st.hands[i.r].slice(), dealer: i.dealer, riichiTurn: i.riichiTurn, own: [...i.own], passed: [...i.passed] })),
    unseen: vis.map(v => 4 - v), opts,
  };
}

export function generate(xml, id, ai) {
  const game = parseMjlog(xml);
  if (game.names.length !== 4) return { eff: [], def: [], tenpai: [] };
  const meta = gameMeta(game, id);
  const out = { eff: [], def: [], tenpai: [] };
  const useAi = !!(ai && ai.points && Object.keys(ai.points).length);
  game.rounds.forEach((round, r) => {
    const effC = [], defC = [], tenC = [];
    replayRound(round, {
      before(st, ev) {
        if (ev.t !== 'discard' || st.drawn[ev.p] == null || st.riichi[ev.p] || st.pending[ev.p]) return;
        const anyRiichi = st.riichi.some(Boolean);
        const turn = st.rivers[ev.p].length;
        if (anyRiichi) {
          if (st.melds[ev.p].length < 3) defC.push({ at: st.seq, p: ev.p, ev });
        } else if (turn >= 1 && turn <= 14) {
          effC.push({ at: st.seq, p: ev.p, ev });
        }
      },
      after(st, ev) {
        if (ev.t !== 'discard' || st.rivers[ev.p].length < 5) return;
        tenC.push(st.seq);
      },
    });
    // 후보 중 일부만 무거운 평가 수행: 두 번째 리플레이에서 선택된 지점에서 생성
    const wantEff = new Set(useAi ? [] : shuffle(effC.slice()).slice(0, 5).map(x => x.at));
    const wantDef = new Set(useAi ? [] : shuffle(defC.slice()).slice(0, 8).map(x => x.at));
    const wantTen = new Set(shuffle(tenC.slice()).slice(0, 4));
    let effGot = 0, defGot = 0;
    const tenGot = [];
    replayRound(round, {
      before(st, ev, i) {
        if (ev.t !== 'discard') return;
        const pt = useAi && ai.points[`${r}:${i}`];
        if (pt && pt.seat === ev.p) {
          const q = pt.mode === 'eff' ? effQuestionAi(st, ev, ev.p, meta, pt, ai.styleMeta) : defQuestionAi(st, ev, ev.p, meta, pt, ai.styleMeta);
          if (q) { q.key = `${meta.id}:${r}:${i}`; out[pt.mode].push(q); }  // key = 오답노트용 안정 ID
        }
        if (wantEff.has(st.seq) && effGot < 2) {
          const q = effQuestion(st, ev, ev.p, meta);
          if (q) { q.key = `${meta.id}:${r}:${i}`; out.eff.push(q); effGot++; }
        }
        if (wantDef.has(st.seq) && defGot < 2) {
          const q = defQuestion(st, ev, ev.p, meta);
          if (q) { q.key = `${meta.id}:${r}:${i}`; out.def.push(q); defGot++; }
        }
      },
      after(st, ev) {
        if (ev.t === 'discard' && wantTen.has(st.seq)) {
          // 관찰자는 방금 버린 사람이 아닌 무작위 플레이어
          const me = pick([0, 1, 2, 3].filter(p => p !== ev.p));
          const q = tenpaiQuestion(st, ev, me, meta);
          if (q) { q.key = `${meta.id}:${r}:${st.seq}:${me}`; tenGot.push(q); }
        }
      },
    });
    // 텐파이 문제는 '텐파이 있음/없음'을 대략 균형 맞춤
    const withT = tenGot.filter(q => q.askedHasTenpai), without = tenGot.filter(q => !q.askedHasTenpai);
    if (withT.length) out.tenpai.push(pick(withT));
    if (without.length) out.tenpai.push(pick(without));
  });
  return out;
}
