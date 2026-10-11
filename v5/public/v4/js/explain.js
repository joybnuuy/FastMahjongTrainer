// 이론 기반 해설 (결정적 계산만 사용 — Mortal이 '왜' 골랐는지는 단정하지 않는다)
import { countsOf, shanten } from './engine.js';
import { doraKind } from './mjlog.js';
import { tileEl } from './tiles.js';
import { decompose, shapeCounts, SHAPE_NAME, ukeireDetail, waitShapes, WAIT_NAME, valueHints } from './theory.js';
import { DANGER_META } from './dangerTable.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const isRed = id => id === 16 || id === 52 || id === 88;
const tileK = (k, cls = 't-opp', red = false) => tileEl(k, { cls, red });
const TILE_NAME = k => k >= 27 ? '東南西北白發中'[k - 27] : (k % 9 + 1) + '만통삭'[Math.floor(k / 9)];
const REL = ['나', '하가', '대면', '상가'];
const shLabel = s => s < 0 ? '화료' : s === 0 ? '텐파이' : s + '샨텐';
const sign = n => (n > 0 ? '+' : '') + n;

function kindsRow(kinds, cls = 't-xs') { const w = el('span', 'inl'); for (const k of kinds) w.append(tileK(k, cls)); return w; }
function ukeireRow(list, cls = 't-opp') { // [{k,n}]
  const w = el('div', 'ukeire');
  for (const { k, n } of list) { const c = el('span', 'uk'); c.append(tileK(k, cls), el('b', '', '×' + n)); w.append(c); }
  return w;
}
function ctxOf(q) {
  const v = q.view;
  return { doraKinds: new Set(v.dora.map(doraKind)), roundWind: 27 + (v.kyoku >= 4 ? 1 : 0), seatWind: 27 + ((v.me - v.oya + 4) % 4) };
}
// 어느 복사본을 버릴지: 적도라 선호 여부(red)에 맞춰 선택
function pickId(hand, kind, preferRed) {
  const ids = hand.filter(t => t >> 2 === kind);
  return (preferRed ? ids.find(isRed) : ids.find(t => !isRed(t))) ?? ids[0];
}

// 블록 분해를 패 그림으로: [멘쯔][탈쯔][머리][고립]
function decompositionEl(d, meldCount = 0) {
  const wrap = el('div', 'decomp');
  const grp = (kinds, label, cls) => { const g = el('div', 'grp ' + (cls || '')); const t = el('div', 'tl'); for (const k of kinds) t.append(tileK(k, 't-opp')); g.append(t, el('span', 'lb', label)); wrap.append(g); };
  if (d.kind === 'chiitoi') {
    d.taatsu.forEach(t => grp(t.k, '또이츠', 'pair'));
    d.isolated.forEach(k => grp([k], '고립', 'iso'));
    return wrap;
  }
  d.mentsu.forEach(m => grp(m, m[0] === m[1] ? '커쯔' : '슌쯔', 'm'));
  d.taatsu.forEach(t => grp(t.k, SHAPE_NAME[t.shape], t.shape));
  if (d.pair != null) grp([d.pair, d.pair], '머리', 'head');
  d.isolated.forEach(k => grp([k], '고립', 'iso'));
  return wrap;
}

// ================= ① 타패 효율 =================
// 옵션 하나를 이론 지표로 분석 (버린 뒤 13장 기준)
function analyzeOption(q, kind, preferRed) {
  const ctx = ctxOf(q);
  const v = q.view, melds = v.melds[v.me];
  const id = pickId(q.hand, kind, preferRed);
  const after = q.hand.filter(t => t !== id);
  const c = countsOf(after), nm = melds.length;
  const meldTiles = melds.flatMap(m => m.tiles);
  const sh = shanten(c, nm);
  const uk = sh >= 0 ? ukeireDetail(c, nm, q.unseen) : { total: 0, kinds: [] };
  // 대기 판정은 텐파이일 때만
  const dec = decompose(c, nm);
  const val = valueHints(after, meldTiles, ctx);
  const discardedValue = (ctx.doraKinds.has(kind) ? 1 : 0) + (isRed(id) ? 1 : 0);
  return { kind, id, sh, uk, dec, counts: shapeCounts(dec), val, discardedValue, after };
}

function optionCard(role, a, extra) {
  const card = el('div', 'xcard');
  const head = el('div', 'xh');
  head.append(el('span', 'role', role), tileK(a.kind, 't-river', isRed(a.id)), el('span', 'sh', `${shLabel(a.sh)}${a.sh >= 0 ? ` · 유효패 ${a.uk.total}장` : ''}`));
  card.append(head);
  if (extra) card.append(el('div', 'muted', extra));
  card.append(decompositionEl(a.dec));
  if (a.sh >= 0 && a.uk.kinds.length) card.append(ukeireRow(a.uk.kinds));
  const c = a.counts, bits = [];
  bits.push(`멘쯔 ${c.mentsu}`);
  if (c.ryanmen) bits.push(`량면 ${c.ryanmen}`);
  if (c.kanchan) bits.push(`간짱 ${c.kanchan}`);
  if (c.penchan) bits.push(`변짱 ${c.penchan}`);
  if (c.pair) bits.push(`또이츠 ${c.pair}`);
  bits.push(c.head ? '머리 있음' : '머리 없음');
  if (c.isolated) bits.push(`고립 ${c.isolated}`);
  card.append(el('div', 'muted', '모양: ' + bits.join(' · ')));
  const vb = [];
  if (a.val.dora) vb.push(`도라 ${a.val.dora}`);
  if (a.val.tanyao) vb.push('탕야오 가능(요구패 0)'); else if (a.val.yaochu <= 3) vb.push(`요구패 ${a.val.yaochu}장`);
  for (const y of a.val.yakuhai) vb.push(`역패 ${TILE_NAME(y.k)} ${y.n}장`);
  if (a.val.honitsu) vb.push(`혼일색 가능(${'만통삭'[a.val.mainSuit]}, 이색 ${a.val.offSuit}장)`);
  if (vb.length) card.append(el('div', 'muted', '타점/역: ' + vb.join(' · ')));
  return card;
}

// A(내 선택) vs B(비교 대상) 사실 비교 문장
function compareSentences(A, B, nameA, nameB) {
  const out = [];
  if (A.sh !== B.sh) out.push(`샨텐: ${nameA} <b>${shLabel(A.sh)}</b> vs ${nameB} <b>${shLabel(B.sh)}</b> — ${A.sh > B.sh ? nameA + '쪽이 한 단계 후퇴합니다' : nameA + '쪽이 더 앞서 있습니다'}.`);
  else {
    out.push(`둘 다 ${shLabel(A.sh)}.`);
    if (A.sh >= 0 && A.uk.total !== B.uk.total) {
      const d = A.uk.total - B.uk.total;
      out.push(`유효패: ${nameA} <b>${A.uk.total}장</b> vs ${nameB} <b>${B.uk.total}장</b> (${sign(d)}장, ${Math.round((A.uk.total / Math.max(1, B.uk.total) - 1) * 100)}%).`);
    } else if (A.sh >= 0) out.push(`유효패 수는 ${A.uk.total}장으로 같습니다.`);
    const aKinds = new Set(A.uk.kinds.map(x => x.k)), bKinds = new Set(B.uk.kinds.map(x => x.k));
    const onlyB = B.uk.kinds.filter(x => !aKinds.has(x.k)), onlyA = A.uk.kinds.filter(x => !bKinds.has(x.k));
    if (onlyB.length) { const s = el('span'); s.append(kindsRow(onlyB.map(x => x.k))); out.push(`${nameB}에만 있는 유효패: ${s.innerHTML}`); }
    if (onlyA.length) { const s = el('span'); s.append(kindsRow(onlyA.map(x => x.k))); out.push(`${nameA}에만 있는 유효패: ${s.innerHTML}`); }
  }
  const ca = A.counts, cb = B.counts, diffs = [];
  for (const [key, label] of [['ryanmen', '량면'], ['kanchan', '간짱'], ['penchan', '변짱'], ['pair', '또이츠'], ['isolated', '고립패'], ['mentsu', '멘쯔']]) {
    if (ca[key] !== cb[key]) diffs.push(`${label} ${ca[key]}→${cb[key]}`);
  }
  if (diffs.length) out.push(`모양 차이(${nameA}→${nameB}): ${diffs.join(', ')}.`);
  if (A.discardedValue !== B.discardedValue) out.push(`도라: ${nameA}은 도라/적도라 <b>${A.discardedValue}장</b>을 버리고 ${nameB}은 <b>${B.discardedValue}장</b>을 버립니다 → 남는 도라 ${A.val.dora} vs ${B.val.dora}개.`);
  if (A.val.tanyao !== B.val.tanyao) out.push(`탕야오: ${nameA} ${A.val.tanyao ? '가능' : '불가'} / ${nameB} ${B.val.tanyao ? '가능' : '불가'}.`);
  if (A.val.yakuhai.length !== B.val.yakuhai.length) out.push(`역패 또이츠/커쯔: ${nameA} ${A.val.yakuhai.length}종 / ${nameB} ${B.val.yakuhai.length}종.`);
  return out;
}

// q: eff 문제, chosen: {kind,id}. 반환 DOM
export function explainEff(q, chosenKind, chosenId) {
  const root = el('div', 'explain');
  root.append(el('h4', '', '📐 이론 해설'));
  const best = q.opts[0];
  const actualOpt = q.opts.find(o => o.kind === q.actual);
  const redOf = k => q.opts.find(o => o.kind === k)?.red ?? false;
  const mine = analyzeOption(q, chosenKind, isRed(chosenId));
  const roles = [{ role: '내 선택', a: mine, kind: chosenKind }];
  if (best.kind !== chosenKind) roles.push({ role: 'Mortal 추천', a: analyzeOption(q, best.kind, redOf(best.kind)), kind: best.kind });
  if (q.actual !== chosenKind && q.actual !== best.kind && actualOpt) roles.push({ role: '실제 플레이어', a: analyzeOption(q, q.actual, redOf(q.actual)), kind: q.actual });
  else if (q.actual === best.kind || q.actual === chosenKind) roles.forEach(r => { if (r.kind === q.actual) r.role += ' · 실제 플레이어와 동일'; });

  // 요약 문장
  const sum = el('ul', 'sum');
  const B = roles.find(r => r.role.startsWith('Mortal'))?.a;
  if (!B) sum.append(el('li', '', `내 선택은 Mortal 추천과 같은 패입니다. 버린 후 <b>${shLabel(mine.sh)}</b>${mine.sh >= 0 ? `, 유효패 <b>${mine.uk.total}장</b>` : ''}.`));
  else for (const s of compareSentences(mine, B, '내 선택', 'Mortal 추천')) sum.append(el('li', '', s));
  const alt = roles.find(r => r.role.startsWith('실제'))?.a;
  if (alt) sum.append(el('li', '', `참고 — 실제 플레이어는 <b>${TILE_NAME(q.actual)}</b>을 버렸습니다 (${shLabel(alt.sh)}${alt.sh >= 0 ? ` · 유효패 ${alt.uk.total}장` : ''}).`));
  root.append(sum);

  // 효율 지표와 Mortal 판단의 일치 여부 (사실만)
  const effBest = [...q.opts].sort((a, b) => a.sh - b.sh || b.ue - a.ue)[0];
  const hint = el('div', 'note');
  if (B && effBest.kind === chosenKind && best.kind !== chosenKind)
    hint.innerHTML = '효율(샨텐→유효패)만 보면 <b>내 선택이 가장 앞섭니다</b>. Mortal이 다른 패를 추천하는 이유는 이 지표로는 설명되지 않습니다 — 타점·역·수비·순위 상황 등 효율 밖의 요소일 수 있으나 확정할 수는 없습니다.';
  else if (B && effBest.kind === best.kind) hint.innerHTML = '효율 지표(샨텐→유효패)도 Mortal 추천과 같은 방향입니다.';
  else if (B) hint.innerHTML = '효율 지표 1순위와 Mortal 추천이 다릅니다. 유효패 수 외의 요소(모양의 질, 타점, 수비 여지)가 작용했을 수 있습니다.';
  root.append(hint);

  const cards = el('div', 'xcards');
  for (const r of roles) cards.append(optionCard(r.role, r.a));
  root.append(cards);
  root.append(el('div', 'ev-slot muted', '📊 화료확률·기대타점 계산 중…'));
  root.append(el('div', 'note', '유효패 = 버린 후 13장에서 샨텐을 줄이는 패 (내 손·모든 버림패·후로·도라표시패를 제외한 남은 장수). 블록 분해는 같은 샨텐 중 멘쯔 수 → 량면 우선으로 고른 한 가지 해석입니다.'));
  return root;
}

// ================= ② 리치 방어 =================
function whySentences(whys, labelOn) {
  const out = [];
  for (const w of whys) {
    const pre = labelOn ? `<b>${w.label}</b>: ` : '';
    for (const x of w.why) {
      let s = null;
      if (x.t === 'genbutsu') s = x.how === 'river' ? '이 패는 상대가 이미 버린 <b>현물</b> — 론 불가(후리텐).' : '리치 후 다른 사람이 버린 패를 상대가 론하지 않았으므로 <b>현물</b> (리치 후 후리텐).';
      else if (x.t === 'suji') s = `<b>${x.both ? '스지' : '편스지'}</b> — 상대의 강에 ${x.partners.map(TILE_NAME).join('·')}이(가) 있어 ${x.both ? '량면 대기가 성립하지 않습니다' : '한쪽 량면 대기만 배제됩니다'}.`;
      else if (x.t === 'kabe') s = `<b>${x.n >= 4 ? '노찬스(벽)' : '원찬스'}</b> — ${x.kinds.map(TILE_NAME).join('·')}이(가) ${x.n}장 보여서 이 패를 쓰는 대기가 줄어듭니다.`;
      else if (x.t === 'honor') s = x.unseen >= 3 ? '자패인데 아직 아무도 안 버렸습니다(남은 3장 이상).' : x.unseen === 2 ? '자패, 이미 1장 더 보임 — 샤보/단기 가능성이 줄어듭니다.' : x.unseen === 1 ? '자패, 남은 1장 — 단기 외에는 거의 불가.' : '자패 4장이 모두 보임 — 론 불가.';
      else if (x.t === 'yakuhai') s = '역패라 상대가 단기/샤보로 기다릴 가능성이 상대적으로 큽니다.';
      else if (x.t === 'dora') s = '<b>도라</b> — 상대가 쥐고 있기 어렵지만 맞으면 점수가 큽니다(타점 가산).';
      else if (x.t === 'nothing') s = `현물·스지·벽 근거가 없는 <b>${x.rank}번 패</b> — 량면/간짱/샤보 등 모든 대기에 걸릴 수 있습니다.`;
      if (s) out.push(pre + s);
    }
  }
  return out;
}

export function explainDef(q, chosenKind, chosenId) {
  const root = el('div', 'explain');
  root.append(el('h4', '', '📐 이론 해설'));
  const v = q.view, ctx = ctxOf(q);
  const nm = v.melds[v.me].length;
  const best = q.opts[0];                                  // Mortal 선호 1순위
  const safest = [...q.opts].sort((a, b) => a.est - b.est)[0];
  const mine = q.opts.find(o => o.kind === chosenKind);
  const actual = q.opts.find(o => o.kind === q.actual);

  // 상황 요약
  const sit = el('ul', 'sum');
  for (const r of q.riichers) {
    sit.append(el('li', '', `<b>${REL[(r.r - v.me + 4) % 4]}</b> 리치 (${r.dealer ? '<b>親</b> — 타점 1.5배' : '자'}, ${r.riichiTurn}순째 선언) — 내가 버리는 패가 이 사람의 대기라면 론입니다.`));
  }
  const c14 = countsOf(q.hand);
  const myAfterBest = (() => { const k = best.kind; const id = pickId(q.hand, k, best.red); const c = countsOf(q.hand.filter(t => t !== id)); const sh = shanten(c, nm); const u = sh >= 0 ? ukeireDetail(c, nm, q.unseen) : { total: 0 }; return { sh, total: u.total }; })();
  sit.append(el('li', '', `내 손패: <b>${shLabel(q.myShanten)}</b>${myAfterBest.sh >= 0 ? ` (Mortal 추천 타패 후 ${shLabel(myAfterBest.sh)}, 유효패 ${myAfterBest.total}장)` : ''}.`));
  const principle = q.myShanten >= 2 ? '일반 원칙: 2샨텐 이상은 리치에 대해 <b>접는 것이 기본</b>입니다.' : q.myShanten === 1 ? '일반 원칙: 1샨텐은 타점·대기·상대 친 여부에 따라 <b>조건부로 밀 수 있는</b> 구간입니다.' : '일반 원칙: 텐파이는 대기가 좋고 타점이 있으면 <b>밀기 쪽</b>이 기본입니다.';
  sit.append(el('li', 'muted', principle));
  root.append(sit);

  // 푸시/폴드 판정 (Mortal 1순위가 가장 안전한 패와 얼마나 다른가)
  const pushGap = best.est - safest.est;
  const mode = pushGap <= 0.01 ? '접기(안전한 패 선택)' : `밀기 (가장 안전한 패보다 추정 방총률 +${(pushGap * 100).toFixed(1)}%p 감수)`;
  root.append(el('div', 'note', `Mortal의 1순위는 <b>${mode}</b>입니다.`));

  // 선택 패 근거
  const block = (title, o) => {
    const b = el('div', 'xcard');
    const h = el('div', 'xh'); h.append(el('span', 'role', title), tileK(o.kind, 't-river', o.red && false), el('span', 'sh', `추정 방총률 ${(o.est * 100).toFixed(1)}%`), o.ron ? el('span', 'tag ron', '실제 론!') : el('span', 'muted', '(실제론 안전)'));
    b.append(h);
    const ws = whySentences(o.whys || [], q.riichers.length > 1);
    const ul = el('ul', 'why');
    for (const s of ws) ul.append(el('li', '', s));
    b.append(ul);
    return b;
  };
  const cards = el('div', 'xcards');
  cards.append(block('내 선택', mine));
  if (best.kind !== chosenKind) cards.append(block('Mortal 추천', best));
  if (safest.kind !== chosenKind && safest.kind !== best.kind) cards.append(block('가장 안전', safest));
  if (actual && actual.kind !== chosenKind && actual.kind !== best.kind && actual.kind !== safest.kind) cards.append(block('실제 플레이어', actual));
  root.append(cards);

  // 비교 문장
  const cmp = el('ul', 'sum');
  if (mine.est > safest.est + 0.004) cmp.append(el('li', '', `내 선택의 추정 방총률은 가장 안전한 패(<b>${TILE_NAME(safest.kind)}</b>)보다 <b>+${((mine.est - safest.est) * 100).toFixed(1)}%p</b> 높습니다.`));
  else cmp.append(el('li', '', '내 선택은 추정 위험이 가장 낮은 패와 같은 수준입니다.'));
  if (mine.sh !== safest.sh) cmp.append(el('li', '', `대신 내 손패 영향: 내 선택 후 ${shLabel(mine.sh)} / 가장 안전한 패 후 ${shLabel(safest.sh)}.`));
  root.append(cmp);

  // 리치자 대기 모양 (왜 그 패가 맞는지)
  const wbox = el('div', 'xcard');
  wbox.append(el('div', 'xh', '<span class="role">리치자의 실제 대기</span>'));
  for (const r of q.riichers) {
    const c13 = countsOf(r.hand);
    const ws = waitShapes(c13, v.melds[r.r].length);
    const line = el('div', 'wline');
    line.append(el('b', '', REL[(r.r - v.me + 4) % 4] + ' '));
    for (const k of r.waits) { const sp = el('span', 'uk'); sp.append(tileK(k, 't-opp'), el('em', '', [...(ws[k] || [])].map(s => WAIT_NAME[s] || s).join('/'))); line.append(sp); }
    if (r.furiten) line.append(el('span', 'tag', '후리텐 — 론 불가'));
    wbox.append(line);
    const cnt = shapeCounts(decompose(c13, v.melds[r.r].length));
    wbox.append(el('div', 'muted', `(${r.waits.length}면 대기${r.waits.length >= 3 ? ' — 3면 이상은 방총 위험이 매우 큼' : ''})`));
  }
  root.append(wbox);
  root.append(el('div', 'ev-slot muted', '⚖️ 푸시/풀 기댓값 계산 중…'));
  const calib = DANGER_META
    ? `추정 방총률은 텐호우 봉황방 로그 ${DANGER_META.games}판에서 실측해 보정한 표(특징: 패 종류·스지·벽·자패 잔여·도라·리치 순목)입니다. 검증 구간 로그손실: 기존 상수 모델 ${DANGER_META.logLoss.constants} → 보정 ${DANGER_META.logLoss.calibrated} (무정보 기준 ${DANGER_META.logLoss.constantBaseline}). 상대 버림 순서·타이밍은 반영하지 않습니다.`
    : '추정 방총률은 현물·스지·벽·자패 잔여·도라만 쓴 고정 휴리스틱입니다.';
  root.append(el('div', 'note', calib));
  return root;
}

// ================= ③ 텐파이 감 =================
export function tenpaiSignals(q, pl) {
  const v = q.view, p = pl.p, river = v.rivers[p], melds = v.melds[p];
  const open = melds.filter(m => m.type !== 'ankan');
  const sig = [];
  const dk = new Set(v.dora.map(doraKind));
  sig.push({ on: open.length >= 2, text: `후로 ${open.length}개` + (open.length >= 2 ? ' — 후로가 많을수록 텐파이/이샨텐일 확률이 높습니다' : '') });
  // 끝에서부터 연속 쯔모기리 (울린 패는 건너뜀)
  let streak = 0;
  for (let i = river.length - 1; i >= 0; i--) { if (river[i].called) continue; if (river[i].tsumogiri) streak++; else break; }
  sig.push({ on: streak >= 3, text: `최근 연속 쯔모기리 ${streak}회` + (streak >= 3 ? ' — 손을 바꾸지 않는 상태(완성형/텐파이 가능성)' : '') });
  const recent = river.filter(e => !e.called).slice(-4);
  const mid = recent.filter(e => { const k = e.tile >> 2; return k < 27 && k % 9 >= 2 && k % 9 <= 6 && !e.tsumogiri; }).length;
  sig.push({ on: mid >= 2 && river.length >= 8, text: `후반 중장패(3~7) 손내밀기 ${mid}개 (최근 4수)` + (mid >= 2 && river.length >= 8 ? ' — 중장패를 쥐고 있을 이유가 없는 손일 수 있음' : '') });
  const doraMeld = melds.reduce((n, m) => n + m.tiles.filter(t => dk.has(t >> 2) || t === 16 || t === 52 || t === 88).length, 0);
  sig.push({ on: doraMeld > 0, text: `후로에 도라/적도라 ${doraMeld}장` + (doraMeld > 0 ? ' — 타점이 있어 밀어붙일 수 있음' : '') });
  sig.push({ on: river.length >= 10, text: `${river.length}순째` + (river.length >= 10 ? ' — 후반에는 텐파이율 자체가 높아집니다' : ' — 아직 중반 이전') });
  return sig;
}

export function explainTenpaiPlayer(q, pl) {
  const v = q.view, box = el('div', 'explain mini');
  const melds = v.melds[pl.p].length;
  const c = countsOf(pl.hand);
  const dec = decompose(c, melds);
  const sh = shanten(c, melds);
  const sig = tenpaiSignals(q, pl);
  const ul = el('ul', 'sig');
  for (const s of sig) ul.append(el('li', s.on ? 'on' : '', `${s.on ? '✔' : '·'} ${s.text}`));
  box.append(el('div', 'muted', '관찰 단서 (참고용 — 확정 규칙 아님)'), ul);
  const hand = el('div', 'muted', `실제 손패: <b>${shLabel(sh)}</b>`);
  box.append(hand, decompositionEl(dec));
  if (sh === 0) {
    const ws = waitShapes(c, melds);
    const line = el('div', 'wline');
    line.append(el('b', '', '대기 '));
    for (const k of pl.waits) { const sp = el('span', 'uk'); sp.append(tileK(k, 't-opp'), el('em', '', [...(ws[k] || [])].map(s => WAIT_NAME[s] || s).join('/'))); line.append(sp); }
    box.append(line);
    const river = new Set(v.rivers[pl.p].map(e => e.tile >> 2));
    if (pl.waits.some(k => river.has(k))) box.append(el('span', 'tag', '자기 강에 대기패가 있음 — 후리텐(론 불가, 쯔모만)'));
  } else {
    const uk = ukeireDetail(c, melds, q.unseen || new Array(34).fill(4));
    box.append(el('div', 'muted', `텐파이까지 ${sh}단계 필요${uk.kinds.length ? ' (진행 패 ' + uk.kinds.length + '종)' : ''}.`));
  }
  const on = sig.filter(s => s.on).length;
  box.append(el('div', 'note', `켜진 단서 ${on}/${sig.length}개 → 실제로는 <b>${sh === 0 ? '텐파이' : '노텐'}</b>. ${on >= 3 && sh !== 0 ? '단서가 많아도 노텐일 수 있습니다 — 단서는 확률일 뿐입니다.' : on <= 1 && sh === 0 ? '단서가 거의 없어도 텐파이일 수 있습니다 — 멘젠 다마텐 등.' : ''}`));
  return box;
}
