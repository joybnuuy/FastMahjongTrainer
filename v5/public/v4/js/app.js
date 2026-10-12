import { gradeAi, findOpt } from './aiutil.js';
import { tileEl, preloadTiles } from './tiles.js';
(globalThis.__MJP ??= { builds: {} }).builds.app = '__MJP_BUILD__';   // 빌드 번호(빌드 때 치환) — 푸터에서 캐시된 이전 버전인지 확인용
preloadTiles();
import { renderTable, renderHandBar } from './table.js';
import { explainEff, explainDef, explainTenpaiPlayer } from './explain.js';
import { fillEffEv, fillPushFold } from './explain-ev.js';

const $ = s => document.querySelector(s);
const REL = ['나', '하가(오른쪽)', '대면', '상가(왼쪽)'];
const REL_SHORT = ['나', '하', '대', '상'];
const tableOpts = reveal => ({ host: document.querySelector('#board'), showMine: true, reveal }); // 세로/가로 모두: 내 손패도 테이블에 표시(표시 전용). 선택은 아래 손패 바에서
const touchMode = matchMedia('(pointer: coarse)').matches; // 터치: 탭 → 선택, 한 번 더 탭/버튼 → 확정

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const isRed = id => id === 16 || id === 52 || id === 88;
const sortIds = ids => ids.slice().sort((a, b) => a - b);
const tile = (kind, o = {}) => tileEl(kind, o);
const tileId = (id, cls = '') => tileEl(id >> 2, { red: isRed(id), cls });
function tilesRow(kinds, cls = 't-opp') {
  const w = el('span', 'rowtiles');
  for (const k of kinds) w.append(tile(k, { cls }));
  return w;
}
const windTile = (v, p) => tile(27 + ((p - v.oya + 4) % 4), { cls: 't-xs' });

// ---------- 상태 ----------
const stats = (() => { try { return JSON.parse(localStorage.getItem('mjp-stats-v2')) || JSON.parse(localStorage.getItem('mjp-stats-v1')) || {}; } catch { return {}; } })();
for (const m of ['eff', 'def', 'danger', 'tenpai']) stats[m] ||= { n: 0, best: 0, ok: 0, streak: 0 };
const saveStats = () => { try { localStorage.setItem('mjp-stats-v2', JSON.stringify(stats)); } catch {} };
const MODE_NAME = { eff: '타패 효율', def: '리치 방어', danger: '위험패 찾기', tenpai: '텐파이 감' };

let mode = 'eff';
const pools = { eff: [], def: [], danger: [], tenpai: [] };
let cur = null, answered = false, custom = false, loading = false, table = null;
let selected = null, ctl = null, curHand = null;
const worker = new Worker('js/worker.js', { type: 'module' });
const pending = new Map();
worker.onmessage = e => { const f = pending.get(e.data.tag); pending.delete(e.data.tag); f && f(e.data); };
let tagSeq = 0;
const gen = (id, xml, ai) => new Promise(res => { const tag = ++tagSeq; pending.set(tag, res); worker.postMessage({ id, xml, tag, ai }); });
const callJob = (job, q, include) => new Promise((res, rej) => { const tag = ++tagSeq; pending.set(tag, d => (d.error ? rej(new Error(d.error)) : res(d.result))); worker.postMessage({ job, q, include, tag }); });
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function loadOne(id) {
  const r = await fetch('/api/game' + (id ? '?id=' + encodeURIComponent(id) : ''));
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  const d = await gen(j.id, j.xml, j.ai);
  if (d.error) throw new Error(d.error);
  d.out.danger = d.out.def; // 위험패 찾기는 리치 방어 문제를 그대로 재사용
  return d.out;
}

async function refill() {
  if (loading || custom) return;
  loading = true;
  try {
    for (let i = 0; i < 6 && Object.values(pools).some(p => p.length < 8) && !custom; i++) {
      setStatus('대국 로그 불러오는 중…');
      const out = await loadOne();
      for (const m of Object.keys(pools)) pools[m].push(...out[m]);
      for (const m of Object.keys(pools)) shuffle(pools[m]);
      if (!cur) next();
    }
  } catch (e) { setStatus('로그 로딩 실패: ' + e.message); }
  loading = false;
  setStatus();
  if (!custom && Object.values(pools).some(p => p.length < 5)) setTimeout(refill, 500);
}

function setStatus(msg) {
  $('#status').textContent = msg || `준비된 문제 — 효율 ${pools.eff.length} · 방어/위험패 ${pools.def.length} · 텐파이 ${pools.tenpai.length}${custom ? ' (지정 대국)' : ''}`;
}
function renderStats() {
  if (nb) { $('#statline').textContent = `📒 남은 ${nb.queue.length} · 이번 ◎${nb.res.best} ○${nb.res.ok} ×${nb.res.bad}`; return; }
  const s = stats[mode];
  $('#statline').textContent = `◎${s.best} ○${s.ok} / ${s.n}문제 · 연속 ${s.streak}`;
}
function record(grade) {
  const s = stats[mode];
  s.n++;
  if (grade === 'best') { s.best++; s.streak++; } else if (grade === 'ok') { s.ok++; s.streak = 0; } else s.streak = 0;
  saveStats(); renderStats();
}

const shLabel = s => s < 0 ? '화료' : s === 0 ? '텐파이' : s + '샨텐';
const gameLink = q => `<a target="_blank" rel="noreferrer" href="https://tenhou.net/0/?log=${q.meta.id}&tw=${q.view.me}">텐호우에서 이 대국 보기</a>`;
const nameOf = (q, p) => q.meta.names[p] || '?';

// ---------- 점수줄(문제 화면) / 점수판(해설 하단) ----------
function scoreStrip(q) {
  const v = q.view, w = document.createDocumentFragment();
  for (let rel = 0; rel < 4; rel++) {
    const p = (v.me + rel) % 4;
    const chip = el('div', 'chip' + (rel === 0 ? ' me' : ''));
    chip.append(windTile(v, p), el('span', 'nm', REL_SHORT[rel]));
    if (p === v.oya) chip.append(el('span', 'dealer', '親'));
    if (v.riichi[p]) chip.append(el('span', 'rb', '리치'));
    chip.append(el('span', 'pt', v.scores[p].toLocaleString()));
    w.append(chip);
  }
  return w;
}
function scoreboard(q) {
  const v = q.view, w = el('div', 'scoreboard');
  for (let rel = 0; rel < 4; rel++) {
    const p = (v.me + rel) % 4;
    const row = el('div', 'sr' + (rel === 0 ? ' me' : ''));
    row.append(windTile(v, p));
    row.append(el('div', 'who', `${REL[rel]}<small>${(q.meta.names[p] || '').replace(/[<>&]/g, '')}</small>`));
    row.append(el('span', '', (p === v.oya ? '<span class="dealer">親</span> ' : '') + (v.riichi[p] ? '<span class="badge">리치</span>' : '')));
    row.append(el('span', 'pt', v.scores[p].toLocaleString()));
    w.append(row);
  }
  return w;
}

// ---------- 손패 바 크기: 패널 너비에 맞춰 1줄/2줄(7열) 자동 선택 ----------
function layoutHand() {
  const bar = curHand?.el, wrap = $('#handwrap');
  if (!bar) return;
  const W = wrap.clientWidth - 8, n = curHand.tiles;
  const w1 = W / (n + 0.9);                // 한 줄에 다 넣을 때 패 너비
  const ref = mode === 'tenpai';            // 텐파이 모드: 내 손패는 참고용이라 작은 한 줄
  const grid = !ref && (w1 < 34 || (touchMode && w1 < 40)); // 너무 작으면 7열 2줄
  const maxHw = innerHeight < 480 ? 42 : 60; // 낮은 화면(폰 가로)에서는 손패를 작게: 판정 요약·다음 버튼이 한 화면에 들어오도록
  const hw = ref ? Math.max(18, Math.min(w1, 30)) : Math.max(24, Math.min(grid ? W / 7.6 : w1, maxHw));
  bar.classList.toggle('grid', grid);
  bar.style.setProperty('--hw', hw.toFixed(1) + 'px');
}
new ResizeObserver(layoutHand).observe($('#handwrap'));

// ---------- 선택/확정 ----------
function makePicker(commit) {
  selected = null;
  return (kind, node, id) => {
    if (answered) return;
    table?.markPick(id);
    if (!touchMode) return commit(kind, node, id);
    if (selected && selected.node === node) return commit(kind, node, id);
    if (selected) selected.node.classList.remove('pick');
    selected = { kind, node, id };
    node.classList.add('pick');
    ctl.btn.disabled = false;
    ctl.hint.textContent = '같은 패를 한 번 더 탭하거나 버튼을 눌러 확정';
    ctl.commit = () => commit(kind, node, id);
  };
}
function discardControls() {
  const box = el('div'); box.style.display = 'contents';
  const hint = el('div', 'hint', touchMode ? '버릴 패를 탭해서 고르세요' : '버릴 패를 클릭하세요 (바로 제출됩니다)');
  const btn = el('button', 'primary big', '이 패 버리기'); btn.disabled = true;
  btn.onclick = () => ctl.commit && ctl.commit();
  box.append(hint);
  if (touchMode) box.append(btn);
  ctl = { box, hint, btn, commit: null };
  return box;
}

// ---------- 선택 직후 한눈에: AI / 고수 / 효율(또는 안전) ----------
function quickPicks(q) {
  if (mode === 'tenpai' || mode === 'danger' || !q.opts?.length) return null;
  const o = q.opts, sh = x => x.sh ?? x.shanten, top = o[0];
  // AI 선택지: Q 격차 0.1 이내는 모두 'A'(◎로 판정되는 범위), 0.7 이내는 흐린 'A'(○ 범위). 적도라/일반패가 나뉜 종류는 따로 센다.
  const aiSel = x => ({ kind: x.kind, red: !!x.red, split: !!x.split });
  const strong = o.filter(x => x.gap <= 0.1).map(aiSel), soft = o.filter(x => x.gap > 0.1 && x.gap <= 0.7).map(aiSel);
  const out = { ai: { kind: top.kind, red: !!top.red, p: q.ai ? top.p : null }, aiAll: q.ai ? strong : [aiSel(top)], aiSoft: q.ai ? soft : [], pro: { kind: q.actual, red: !!q.actualRed, split: o.some(x => x.split && x.kind === q.actual), id: q.actualId } };
  if (mode === 'eff') {
    const minSh = Math.min(...o.map(sh));
    const cand = o.filter(x => sh(x) === minSh);
    const maxUe = Math.max(...cand.map(x => x.ue));
    out.eff = { kinds: cand.filter(x => x.ue === maxUe).map(x => x.kind), ue: maxUe, sh: minSh };
  } else {
    const est = x => x.est ?? x.p;
    const minE = Math.min(...o.map(est));
    out.safe = { kinds: o.filter(x => est(x) <= minE + 0.004).map(x => x.kind), est: minE };
  }
  return out;
}
function quickRow(q, qp) {
  const row = el('div', 'quick');
  // items: [{kind, red}] (적도라 표시까지 포함) 또는 종류 번호 배열
  const chip = (cls, label, items, extra) => {
    const c = el('div', 'qchip ' + cls);
    c.append(el('span', 'ql', label));
    const list = items.map(x => (typeof x === 'number' ? { kind: x, red: false } : x));
    list.slice(0, 4).forEach(x => c.append(tile(x.kind, { cls: 't-qc', red: !!x.red })));
    if (list.length > 4) c.append(el('span', 'qx', '+' + (list.length - 4)));
    if (extra) c.append(el('span', 'qx', extra));
    return c;
  };
  row.append(chip('ai', q.ai ? 'AI' : '추천', qp.aiAll, qp.ai.p != null ? Math.round(qp.ai.p * 100) + '%' : ''));
  row.append(chip('pro', '고수', [qp.pro], ''));
  if (qp.eff) row.append(chip('eff', '효율', qp.eff.kinds, `${qp.eff.sh <= 0 ? '' : qp.eff.sh + '샨텐 '}${qp.eff.ue}장`));
  if (qp.safe) row.append(chip('eff', '최안전', qp.safe.kinds, (qp.safe.est * 100).toFixed(1) + '%'));
  return row;
}
// 손패 바의 해당 패 위에 배지 (AI / 고수 / 효율·안전)
function badgeHand(qp) {
  const marks = {}, idMarks = {};
  // 적도라와 일반패를 둘 다 들고 있는 종류(split)는 배지도 해당 패(적도라/일반)에만 붙인다
  const keyOf = (kind, red, split) => split ? `${kind}${red ? 'r' : 'n'}` : String(kind);
  const add = (x, tag, cls) => { (marks[keyOf(x.kind, x.red, x.split)] ||= []).push([tag, cls]); };
  const addKind = (k, tag, cls) => { (marks[String(k)] ||= []).push([tag, cls]); };
  (qp.aiSoft || []).forEach(x => add(x, 'A', 'ai soft'));   // 0.7 이내: 흐린 A
  (qp.aiAll || [qp.ai]).forEach(x => add(x, 'A', 'ai'));     // 0.1 이내: 진한 A
  // 고수 배지는 실제로 버린 그 한 장에만 붙인다 (같은 패가 두 장일 때 쯔모패/손패 구분, 적도라 구분). id 를 모르는 옛 문제는 종류 단위.
  if (qp.pro.id != null) idMarks[qp.pro.id] = [['고', 'pro']]; else add(qp.pro, '고', 'pro'); // 한 글자 원형 배지 (아래 칩의 색과 대응: 파랑=AI, 주황=고수, 초록=효율/안전)
  (qp.eff?.kinds || []).forEach(k => addKind(k, '효', 'eff'));
  (qp.safe?.kinds || []).forEach(k => addKind(k, '안', 'eff'));
  const splitKinds = new Set([...(qp.aiAll || []), ...(qp.aiSoft || []), qp.pro].filter(x => x.split).map(x => x.kind));
  document.querySelectorAll('#handwrap .tile').forEach(t => {
    const kind = +t.dataset.kind, id = +t.dataset.id;
    const m = [...(marks[String(kind)] || []), ...(splitKinds.has(kind) ? (marks[keyOf(kind, isRed(id), true)] || []) : []), ...(idMarks[id] || [])];
    if (!m.length) return;
    const w = el('div', 'bdgs');
    m.forEach(([tag, cls]) => w.append(el('span', 'bdg ' + cls, tag)));
    t.append(w);
  });
}

function finish(grade, nodes, { keepControls = false, pick } = {}) {
  answered = true;
  if (!replay) record(grade);   // 오답노트에서 다시 푸는 문제는 통계에 넣지 않음 (노트의 시도 기록에만 반영)
  else if (nb) { nb.res[grade]++; renderStats(); }
  saveNote(grade, pick);
  $('#prompt').hidden = true; // 풀이가 끝난 뒤에는 안내문을 접어 공간을 확보
  const fb = $('#feedback');
  fb.replaceChildren(...nodes, scoreboard(cur));
  $('#result').hidden = false;
  // 문제 화면의 조작부: 판정 한 줄 + 다음 문제 + 아래로 스크롤 안내
  const verdict = el('div', 'verdict');
  const banner = nodes[0]?.classList?.contains('banner') ? nodes[0].cloneNode(true) : el('div', `banner ${grade}`, grade === 'best' ? '◎' : grade === 'ok' ? '○' : '×');
  const qp = quickPicks(cur);
  verdict.append(banner);
  if (qp) { verdict.append(quickRow(cur, qp)); badgeHand(qp); }
  verdict.append(el('div', 'scrollhint', '▼ 아래로 스크롤하면 해설'));
  const nextBtn = el('button', 'primary big', '다음 문제'); nextBtn.onclick = next;
  const box = el('div'); box.style.display = 'contents';
  box.append(verdict, nextBtn);
  if (keepControls) ctl.box.append(box); else $('#controls').replaceChildren(box);
  nextBtn.focus({ preventScroll: true });
}

// ---------- Mortal 기반 피드백 ----------
const pctS = x => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
const probBar = p => `<span class="bar ai" style="width:${Math.round(p * 100)}px"></span>${pctS(p)}`;
const BADGE = { best: '◎ Mortal과 같은 선택', ok: '○ 허용 범위 (Mortal도 꽤 고려하는 패)', bad: '× Mortal은 선호하지 않는 선택' };

// 스타일 참고: 스타일 헤드(성향 프로필)가 같은 지점을 어떻게 보는지. 참고 표시일 뿐 채점에는 쓰지 않는다.
function styleRefNode(q, kind, red) {
  if (!q.styles || !q.styles.length) return null;
  const box = el('div', 'stylebox');
  box.append(el('div', 'stitle', '스타일 참고 <span class="muted">· 채점에는 반영되지 않습니다</span>'));
  for (const s of q.styles) {
    const mine = findOpt(s.opts, kind, red), idx = s.opts.indexOf(mine), top = s.opts[0];
    const row = el('div', 'srow');
    row.append(el('b', '', s.name));
    const rec = el('span', 'srec'); rec.append('추천 ', tile(top.kind, { cls: 't-river', red: top.red }));
    row.append(rec, el('span', mine && idx === 0 ? 'ok' : 'muted', mine ? (idx === 0 ? '내 선택과 같음 ★' : `내 선택 ${idx + 1}위 (격차 -${mine.gap.toFixed(2)})`) : ''));
    box.append(row);
    if (s.desc) box.append(el('div', 'sdesc muted', s.desc));
  }
  return box;
}

// 실제 플레이어가 쯔모패를 그대로 버렸는지(쯔모기리) 손패에서 버렸는지 (천봉 로그에 있는 정보: 버린 패 id 가 쯔모한 패 id 와 같은지)
const tgTag = q => (q.actualId == null || q.drawn == null) ? '' : q.actualId === q.drawn ? ' (쯔모기리)' : ' (손패에서)';
function effFeedbackAi(q, kind, id) {
  const red = id != null && isRed(id);
  const grade = gradeAi(q.opts, kind, red);
  const best = q.opts[0], mine = findOpt(q.opts, kind, red);
  const isAct = o => o.kind === q.actual && (!o.split || o.red === !!q.actualRed);
  const minSh = q.opts.reduce((m, x) => Math.min(m, x.sh), 9);
  const tbl = el('table');
  tbl.innerHTML = '<tr><th>버림</th><th>Mortal 선택 확률</th><th>Q 격차</th><th>효율</th><th></th></tr>';
  for (const o of q.opts) {
    if (o.p < 0.005 && o !== mine && !isAct(o)) continue;
    const tr = el('tr', (o === mine ? 'mine ' : '') + (isAct(o) ? 'act' : ''));
    const t0 = el('td'); t0.append(tile(o.kind, { cls: 't-river', red: o.red }));
    tr.append(t0, el('td', '', probBar(o.p)), el('td', 'muted', o.gap === 0 ? '—' : '-' + o.gap.toFixed(2)),
      el('td', 'muted', `${shLabel(o.sh)}${o.sh === minSh ? ' · ' + o.ue + '장' : ''}`),
      el('td', 'muted', (o.rank === 0 ? '★ Mortal 추천' : '') + (o === mine ? ' · 내 선택' + (id != null && id === q.drawn ? ' (쯔모패)' : '') : '') + (isAct(o) ? ' · 실제 플레이어' + tgTag(q) : '')));
    tbl.append(tr);
  }
  const ban = el('div', `banner ${grade}`, BADGE[grade]);
  const lines = [`내 선택 확률 ${pctS(mine.p)} (Q 격차 -${mine.gap.toFixed(2)}) · Mortal 추천 ${pctS(best.p)}`];
  if (q.pReach >= 0.05) lines.push(`이 손에서 Mortal은 <b>리치</b>를 ${pctS(q.pReach)} 확률로 선택합니다 (확률은 리치/다마 합산).`);
  const note = el('div', 'note', `${lines.join('<br>')}<br>Mortal S42 (Q값을 softmax 변환한 확률). Q 격차 0.1 이내 ◎, 0.7 이내 ○. ${gameLink(q)}`);
  return { grade, nodes: [ban, tbl, styleRefNode(q, kind, red), note].filter(Boolean) };
}

function riichersBox(q) {
  const rv = el('div', 'note');
  for (const r of q.riichers) {
    const box = el('div', 'muted', `${REL[(r.r - q.view.me + 4) % 4]} (${nameOf(q, r.r)}) 대기:`);
    box.append(tilesRow(r.waits));
    if (r.furiten) box.append(el('span', 'tag', '후리텐 — 론 불가'));
    rv.append(box);
  }
  return rv;
}

function defFeedbackAi(q, kind, id) {
  const red = id != null && isRed(id);
  const grade = gradeAi(q.opts, kind, red);
  const mine = findOpt(q.opts, kind, red);
  const isAct = o => o.kind === q.actual && (!o.split || o.red === !!q.actualRed);
  const tbl = el('table');
  tbl.innerHTML = '<tr><th>버림</th><th>Mortal 선택 확률</th><th>추정 방총률</th><th>근거</th><th>실제</th></tr>';
  for (const o of q.opts) {
    if (o.p < 0.005 && o !== mine && !isAct(o) && !o.ron) continue;
    const tr = el('tr', (o === mine ? 'mine ' : '') + (isAct(o) ? 'act' : ''));
    const t0 = el('td'); t0.append(tile(o.kind, { cls: 't-river', red: o.red }));
    tr.append(t0, el('td', '', probBar(o.p) + (o.rank === 0 ? ' <span class="muted">★</span>' : '')),
      el('td', 'muted', (o.est * 100).toFixed(1) + '%'),
      el('td', '', o.tags.map(t => `<span class="tag">${t}</span>`).join('') || '<span class="muted">정보 없음</span>'),
      el('td', '', (o.ron ? '<span class="tag ron">론!</span>' : '<span class="muted">안전</span>') + (isAct(o) ? ' <span class="muted">· 실제 플레이어' + tgTag(q) + '</span>' : '')));
    tbl.append(tr);
  }
  const ban = el('div', `banner ${grade}`, BADGE[grade] + (mine.ron ? ' — 단, 이 패는 실제로 론 당합니다 💥' : ''));
  const rv = riichersBox(q);
  rv.append(el('div', 'note', `리치자의 손패는 테이블에서 공개했습니다. 내 손패는 ${shLabel(q.myShanten)}. Mortal은 밀기/접기까지 포함해 판단합니다(★ = Mortal 추천). ${gameLink(q)}`));
  return { grade, nodes: [ban, tbl, styleRefNode(q, kind, red), rv].filter(Boolean) };
}

function revealRiichers(q) {
  const map = {};
  for (const r of q.riichers) map[r.r] = r.hand;
  table.reveal(map);
}

// ---------- ① 타패 효율 ----------
function showEff(q) {
  const commit = (kind, node, id) => {
    if (answered) return;
    node.classList.add('pick');
    if (q.ai) {
      const r = effFeedbackAi(q, kind, id), ex = explainEff(q, kind, id);
      r.nodes.push(ex); finish(r.grade, r.nodes, { pick: kind });
      const slot = ex.querySelector('.ev-slot');
      callJob('eff', q, [kind, q.opts[0].kind, q.actual]).then(res => fillEffEv(slot, q, res, kind), err => { slot.textContent = '계산 실패: ' + err.message; });
      return;
    }
    const grade = gradeOf(q, kind);
    const tbl = el('table');
    tbl.innerHTML = '<tr><th>버림</th><th>버린 후</th><th>우케이레</th><th></th></tr>';
    for (const o of q.opts) {
      const tr = el('tr', (o.kind === kind ? 'mine ' : '') + (o.kind === q.actual ? 'act' : ''));
      const td0 = el('td'); td0.append(tile(o.kind, { cls: 't-river' }));
      const dr = el('td'); dr.append(el('span', '', o.shanten === q.opts[0].shanten ? `${o.ue}장 ` : '—'));
      if (o.shanten === q.opts[0].shanten) dr.append(tilesRow(o.draws.map(d => d.k)));
      tr.append(td0, el('td', '', shLabel(o.shanten)), dr, el('td', 'muted', (o.rank === 0 ? '★ 추천' : '') + (o.kind === kind ? ' · 내 선택' : '') + (o.kind === q.actual ? ' · 실제 플레이어' : '')));
      tbl.append(tr);
    }
    const best = q.opts[0], mine = q.opts.find(o => o.kind === kind);
    const ban = el('div', `banner ${grade}`, { best: '◎ 정답', ok: '○ 허용 범위', bad: '× 비효율' }[grade]);
    const why = el('div', 'muted', grade === 'best' ? `추천 타패와 같거나 사실상 동급입니다 (${shLabel(mine.shanten)}, 우케이레 ${mine.ue}장).`
      : `내 선택: ${shLabel(mine.shanten)}${mine.shanten === best.shanten ? ` · ${mine.ue}장` : ''} → 추천: ${shLabel(best.shanten)} · ${best.ue}장`);
    finish(grade, [ban, why, tbl, el('div', 'note', `효율(샨텐→우케이레→잠재력) 기준입니다. ${gameLink(q)}`)], { pick: kind });
  };
  return {
    prompt: `<b>${q.turn}순째</b> · 버릴 패를 고르세요<br><span class="sub">상대 패는 모른다고 가정${q.ai ? ' · Mortal AI 기준' : ' · 효율 기준'}</span>`,
    table: renderTable(q, tableOpts()),
    hand: renderHandBar(q, { onPick: makePicker(commit) }),
    controls: discardControls(),
  };
}
function gradeOf(q, kind) {
  const best = q.opts[0], o = q.opts.find(x => x.kind === kind);
  if (o === best) return 'best';
  if (o.shanten === best.shanten && o.deep && best.deep && o.next != null && 0.6 * o.ue + 0.4 * o.next >= 0.6 * best.ue + 0.4 * best.next - 0.8) return 'best';
  if (o.shanten === best.shanten && o.ue >= 0.9 * best.ue) return 'ok';
  return 'bad';
}

// ---------- ② 리치 방어 ----------
function showDef(q) {
  const rs = q.riichers.map(r => REL_SHORT[(r.r - q.view.me + 4) % 4]).join('·');
  const t = renderTable(q, tableOpts());
  const commit = (kind, node, id) => {
    if (answered) return;
    node.classList.add('pick');
    revealRiichers(q);
    if (q.ai) {
      const r = defFeedbackAi(q, kind, id), ex = explainDef(q, kind, id);
      r.nodes.push(ex); finish(r.grade, r.nodes, { pick: kind });
      const slot = ex.querySelector('.ev-slot');
      callJob('def', q, [kind, q.actual]).then(res => fillPushFold(slot, q, res, kind), err => { slot.textContent = '계산 실패: ' + err.message; });
      return;
    }
    const minP = q.opts[0].p, mine = q.opts.find(o => o.kind === kind);
    let grade = mine.p <= minP + 0.004 ? 'best' : mine.p <= minP + 0.02 ? 'ok' : 'bad';
    if (mine.ron) grade = 'bad';
    const tbl = el('table');
    tbl.innerHTML = '<tr><th>버림</th><th>추정 방총률</th><th>근거</th><th>실제</th></tr>';
    for (const o of q.opts) {
      const tr = el('tr', (o.kind === kind ? 'mine ' : '') + (o.kind === q.actual ? 'act' : ''));
      const t0 = el('td'); t0.append(tile(o.kind, { cls: 't-river' }));
      tr.append(t0, el('td', '', `<span class="bar" style="width:${Math.min(o.p * 400, 80)}px"></span>${(o.p * 100).toFixed(1)}%`),
        el('td', '', o.tags.map(x => `<span class="tag">${x}</span>`).join('') || '<span class="muted">정보 없음</span>'),
        el('td', '', (o.ron ? '<span class="tag ron">론!</span>' : '<span class="muted">안전</span>') + (o.kind === q.actual ? ' <span class="muted">· 실제 플레이어</span>' : '')));
      tbl.append(tr);
    }
    const ban = el('div', `banner ${grade}`, mine.ron ? '💥 방총! 이 패는 실제로 론 당합니다' : grade === 'best' ? '◎ 안전한 선택' : grade === 'ok' ? '○ 차선' : '× 위험한 선택 (이번엔 운 좋게 안 맞음)');
    const rv = riichersBox(q);
    rv.append(el('div', 'note', `방총률은 휴리스틱 추정치입니다. ${gameLink(q)}`));
    finish(grade, [ban, tbl, rv], { pick: kind });
  };
  return {
    prompt: `<b>${rs} 리치</b> · 내 손 ${shLabel(q.myShanten)}<br><span class="sub">론패를 들고 있습니다 — 밀지 접을지도 판단하세요</span>`,
    table: t,
    hand: renderHandBar(q, { onPick: makePicker(commit) }),
    controls: discardControls(),
  };
}

// ---------- 위험패 후보 찾기 (리치 방어 문제를 재사용: 손 안에서 실제로 론당하는 패를 최대 3개 고르기) ----------
function showDanger(q) {
  const est = o => o.est ?? o.p;
  const ronKinds = q.opts.filter(o => o.ron).map(o => o.kind);
  const waitKinds = new Set(q.riichers.flatMap(r => (r.furiten ? [] : r.waits)));  // 리치자들의 대기패 종류 (후리텐 제외)
  const uniq = new Set(q.hand.map(t => t >> 2)).size;
  const MAXPICK = Math.min(uniq, Math.max(1, waitKinds.size) + 2);                  // 대기 1종→3개, 2종→4개, 3종→5개
  const sel = new Set();
  const sub = el('button', 'primary big', '정답 확인'); sub.disabled = true;
  const hint = el('div', 'hint');
  const paint = () => {
    document.querySelectorAll('#handwrap .tile').forEach(t => t.classList.toggle('pick', sel.has(+t.dataset.kind)));
    sub.disabled = !sel.size;
    hint.textContent = `위험하다고 생각하는 패 선택 ${sel.size}/${MAXPICK} (다시 탭하면 해제)`;
  };
  const onPick = kind => {
    if (answered) return;
    if (sel.has(kind)) sel.delete(kind);
    else if (sel.size < MAXPICK) sel.add(kind);
    paint();
  };
  sub.onclick = () => {
    if (answered || !sel.size) return;
    revealRiichers(q);
    const picked = [...sel], hit = picked.filter(k => ronKinds.includes(k)), wrong = picked.filter(k => !ronKinds.includes(k));
    // 론패를 하나도 빠짐없이 선택 안에 넣으면 정답 (여분의 선택은 허용: 대기 종류 + 2개까지)
    const grade = hit.length === ronKinds.length ? 'best' : hit.length ? 'ok' : 'bad';
    const ban = el('div', `banner ${grade}`, grade === 'best' ? `◎ 정답 — 론패 ${ronKinds.length}종을 모두 잡았습니다${wrong.length ? ` (여분 ${wrong.length})` : ''}`
      : grade === 'ok' ? `○ 부분 정답 — 론패 ${hit.length}/${ronKinds.length}종만 잡았습니다` : `× 론패 ${ronKinds.length}종을 하나도 못 잡았습니다`);
    const tbl = el('table');
    tbl.innerHTML = '<tr><th>패</th><th>추정 방총률</th><th>근거</th><th>결과</th></tr>';
    for (const o of [...q.opts].sort((a, b) => b.ron - a.ron || est(b) - est(a))) {
      const mark = sel.has(o.kind) ? (o.ron ? '<span class="tag ron">론! ✓ 맞힘</span>' : '<span class="tag">✗ 안전한 패</span>') : (o.ron ? '<span class="tag ron">론! (놓침)</span>' : '<span class="muted">안전</span>');
      const tr = el('tr', (sel.has(o.kind) ? 'mine' : ''));
      const t0 = el('td'); t0.append(tile(o.kind, { cls: 't-river', red: o.red }));
      tr.append(t0, el('td', '', `<span class="bar" style="width:${Math.min(est(o) * 400, 80)}px"></span>${(est(o) * 100).toFixed(1)}%`),
        el('td', '', (o.tags || []).map(x => `<span class="tag">${x}</span>`).join('') || '<span class="muted">정보 없음</span>'), el('td', '', mark));
      tbl.append(tr);
    }
    const rv = riichersBox(q);
    rv.append(el('div', 'note', `론패 = 리치자의 대기패 중 내 손에 있는 패 (후리텐이면 론 불가). 방총률은 휴리스틱 추정치입니다. ${gameLink(q)}`));
    document.querySelectorAll('#handwrap .tile').forEach(t => {
      if (!ronKinds.includes(+t.dataset.kind)) return;
      const w = el('div', 'bdgs'); w.append(el('span', 'bdg pro', '론')); t.append(w);
    });
    finish(grade, [ban, tbl, rv], { pick: picked });
  };
  const box = el('div'); box.style.display = 'contents';
  box.append(hint, sub);
  ctl = { box, hint, btn: sub, commit: null };
  setTimeout(paint);
  const rs = q.riichers.map(r => REL_SHORT[(r.r - q.view.me + 4) % 4]).join('·');
  return {
    prompt: `<b>${rs} 리치</b><br><span class="sub">손패 중 <b>실제로 론당할 패</b>를 최대 ${MAXPICK}개까지 고르세요 (대기 ${waitKinds.size}종 + 2). 모두 포함하면 정답 · 같은 패는 한 장으로 표시</span>`,
    table: renderTable(q, tableOpts()),
    hand: renderHandBar(q, { onPick, unique: true }),
    controls: box,
  };
}

// ---------- ③ 텐파이 감 ----------
function showTenpai(q) {
  const t = renderTable(q, tableOpts());
  const guess = {}, rowOf = {};
  const box = el('div'); box.style.display = 'contents';
  const rows = el('div', 'tp-rows');
  const sub = el('button', 'primary big', '정답 확인'); sub.disabled = true;
  for (const pl of q.players) {
    const row = el('div', 'tp-row');
    const rel = (pl.p - q.view.me + 4) % 4;
    row.append(windTile(q.view, pl.p), el('div', 'who', `${REL_SHORT[rel]}<small>${nameOf(q, pl.p).replace(/[<>&]/g, '')}</small>`));
    if (pl.riichi) row.append(el('span', 'fixed', '리치 = 텐파이'));
    else {
      const bs = [];
      for (const [val, label] of [[true, '텐파이'], [false, '노텐']]) {
        const b = el('button', '', label);
        b.onclick = () => {
          if (answered) return;
          guess[pl.p] = val;
          bs.forEach(x => x.classList.toggle('sel', x === b));
          sub.disabled = !q.players.every(x => x.riichi || guess[x.p] !== undefined);
        };
        bs.push(b); row.append(b);
      }
    }
    rowOf[pl.p] = row; rows.append(row);
  }
  sub.onclick = () => {
    if (answered) return;
    let right = 0, asked = 0;
    const map = {}, cards = [];
    for (const pl of q.players) {
      map[pl.p] = pl.hand;
      if (pl.riichi) continue;
      asked++;
      const ok = guess[pl.p] === pl.tenpai;
      if (ok) right++;
      rowOf[pl.p].classList.add(ok ? 'right' : 'wrong');
      const card = el('div', 'card ' + (ok ? 'right' : 'wrong'));
      const h3 = el('h3'); h3.append(windTile(q.view, pl.p), document.createTextNode(`${REL[(pl.p - q.view.me + 4) % 4]} · ${nameOf(q, pl.p)}`));
      card.append(h3);
      const r = el('div', 'muted', `${ok ? '✓' : '✗'} 실제: <b>${pl.tenpai ? '텐파이' : '노텐'}</b>${pl.tenpai ? ' · 대기' : ''}`);
      if (pl.tenpai) r.append(tilesRow(pl.waits));
      card.append(r, explainTenpaiPlayer(q, pl));
      cards.push(card);
    }
    table.reveal(map);
    sub.disabled = true; sub.hidden = true;
    const grade = right === asked ? 'best' : 'bad';
    const cardsWrap = el('div', 'cards');
    cards.forEach(c => cardsWrap.append(c));
    finish(grade, [el('div', `banner ${grade}`, `${right}/${asked} 정답`), cardsWrap, el('div', 'note', `텐파이 = 실제 손패 기준(역 유무 무관). 상대 손패는 테이블에서 공개했습니다. ${gameLink(q)}`)], { keepControls: true, pick: { ...guess } });
  };
  box.append(rows, sub);
  ctl = { box };
  return {
    prompt: '<b>상대 3명, 지금 텐파이?</b><br><span class="sub">버림패·후로·점수 상황으로 판단 (타패 직후)</span>',
    table: t,
    hand: renderHandBar(q, {}),
    controls: box,
  };
}

// ---------- 오답노트 (서버 ../data/notebook.json; 포맷은 server.js 주석 참고) ----------
// 항목 id = `${mode}:${q.key}`, history[] = { t, grade('ok'|'bad'), pick(고른 패 종류/배열/텐파이 추측), pro(고른 패 === 실제 플레이어 선택) }
let notes = { entries: {} }, replay = false;
const loadNotes = () => fetch('/api/notebook').then(r => r.json()).then(j => { notes = j; renderNotes(); }).catch(() => {});
function saveNote(grade, pick) {
  const q = cur;
  if (!q?.key) return;
  const id = `${mode}:${q.key}`, known = notes.entries[id];
  if (grade === 'best' && !known) return;   // 틀린 문제만 새로 저장, 이미 있는 문제는 맞혀도 시도 기록
  const attempt = { t: Date.now(), grade, pick: pick ?? null, pro: typeof pick === 'number' && pick === q.actual };
  const e = known || (notes.entries[id] = { id, mode, q, created: Date.now(), history: [] });
  e.history.push(attempt);
  fetch('/api/notebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mode, q: known ? undefined : q, attempt }) })
    .then(renderNotes, () => {});
}
function renderNotes() {
  const box = $('#notelist');
  if (!box) return;
  const es = Object.values(notes.entries).sort((a, b) => b.created - a.created);
  $('#notecount').textContent = es.length;
  box.replaceChildren();
  for (const e of es) {
    const wrong = e.history.filter(h => h.grade !== 'best').length;
    const row = el('div', 'noterow', `<b>${MODE_NAME[e.mode] || e.mode}</b> <span class="muted">${e.q.meta?.id || ''} · ${e.history.length}회 시도 / ${wrong}회 오답${nbGraduated(e) ? ' · 🎓졸업' : ''} · 최근 ${e.history.at(-1).grade === 'best' ? '◎' : e.history.at(-1).grade === 'ok' ? '○' : '×'}</span> `);
    const go = el('button', '', '풀기'); go.onclick = () => { scrollTo({ top: 0 }); nb = null; present(e.q, e.mode); };
    const del = el('button', '', '삭제'); del.onclick = () => { delete notes.entries[e.id]; renderNotes(); fetch('/api/notebook?id=' + encodeURIComponent(e.id), { method: 'DELETE' }); };
    row.append(go, del);
    box.append(row);
  }
  if (!es.length) box.textContent = '아직 틀린 문제가 없습니다.';
}

// ---------- 오답노트 셔플 풀기 ----------
let nb = null; // 진행 중인 세션 { queue, res }  (설정 화면에서는 null)
const NB_DEFAULT = { modes: ['eff', 'def', 'danger', 'tenpai'], bad: true, ok: false, noPro: false, unresolved: false, grad: false };
const nbOpts = (() => { try { return { ...NB_DEFAULT, ...JSON.parse(localStorage.getItem('mjp-nb-opts')) }; } catch { return { ...NB_DEFAULT }; } })();
// 항목의 '레벨' = 처음 틀렸을 때의 판정 (bad = 오답, ok = Mortal이 선택할 수도 있는 범위)
// 졸업: 10회 이상 풀었고 최근 15회 중 ◎ 비율이 80% 이상 → 셔플에서 빠지고 기록(history)만 남음
const NB_GRAD = { minTries: 10, window: 15, rate: 0.8 };
function nbGraduated(e) {
  const h = e.history;
  if (h.length < NB_GRAD.minTries) return false;
  const w = h.slice(-NB_GRAD.window);
  return w.filter(x => x.grade === 'best').length / w.length >= NB_GRAD.rate;
}
function nbMatches(opts) {
  return Object.values(notes.entries).filter(e => {
    const first = e.history[0], last = e.history.at(-1);
    if (!opts.grad && nbGraduated(e)) return false;
    if (!opts.modes.includes(e.mode)) return false;
    if (!(first.grade === 'ok' ? opts.ok : opts.bad)) return false;
    if (opts.noPro && e.history.some(h => h.pro)) return false;           // 플레이어(고수)도 그렇게 둔 오답은 제외
    if (opts.unresolved && last.grade === 'best') return false;           // 마지막 시도에서 맞힌 건 제외
    return true;
  });
}
function nbSetup(msg) {
  nb = null; cur = null; table = null; curHand = null; replay = false; answered = false;
  $('#result').hidden = true; $('#feedback').replaceChildren();
  $('#strip').replaceChildren(); $('#handwrap').replaceChildren(); $('#controls').replaceChildren();
  $('#prompt').hidden = false; $('#prompt').innerHTML = '<b>📒 오답노트</b><br><span class="sub">틀린 문제를 섞어서 다시 풉니다</span>';
  $('#statline').textContent = `📒 저장된 오답 ${Object.keys(notes.entries).length}개`;
  const box = el('div', 'nbsetup');
  if (msg) box.append(el('div', 'banner best', msg));
  const start = el('button', 'primary big', '');
  const count = el('div', 'muted');
  const refresh = () => {
    try { localStorage.setItem('mjp-nb-opts', JSON.stringify(nbOpts)); } catch {}
    const n = nbMatches(nbOpts).length;
    count.textContent = `조건에 맞는 문제 ${n}개 / 전체 ${Object.keys(notes.entries).length}개`;
    start.textContent = `섞어서 풀기 시작 (${n})`; start.disabled = !n;
  };
  const check = (label, get, set) => {
    const l = el('label', 'nbopt'), c = el('input'); c.type = 'checkbox'; c.checked = get();
    c.onchange = () => { set(c.checked); refresh(); };
    l.append(c, document.createTextNode(' ' + label)); return l;
  };
  const g1 = el('div', 'nbgroup', '<b>종류</b>');
  for (const m of ['eff', 'def', 'danger', 'tenpai']) {
    const n = Object.values(notes.entries).filter(e => e.mode === m).length;
    g1.append(check(`${MODE_NAME[m]} (${n})`, () => nbOpts.modes.includes(m), v => { nbOpts.modes = nbOpts.modes.filter(x => x !== m); if (v) nbOpts.modes.push(m); }));
  }
  const g2 = el('div', 'nbgroup', '<b>난이도 그룹</b>');
  g2.append(check('× 오답 (Mortal이 선호하지 않는 선택)', () => nbOpts.bad, v => { nbOpts.bad = v; }),
    check('○ 허용 범위 (Mortal도 둘 수 있는 선택)', () => nbOpts.ok, v => { nbOpts.ok = v; }));
  const g3 = el('div', 'nbgroup', '<b>제외</b>');
  g3.append(check('고수 플레이어도 같은 선택을 한 오답 제외', () => nbOpts.noPro, v => { nbOpts.noPro = v; }),
    check('마지막에 맞힌 문제 제외 (아직 못 푼 것만)', () => nbOpts.unresolved, v => { nbOpts.unresolved = v; }),
    check(`졸업한 문제도 포함 (${Object.values(notes.entries).filter(nbGraduated).length}개 · 10회↑ 풀고 최근 15회 정답률 80%↑)`, () => nbOpts.grad, v => { nbOpts.grad = v; }));
  start.onclick = () => {
    const queue = shuffle(nbMatches(nbOpts));
    if (!queue.length) return;
    nb = { queue, res: { best: 0, ok: 0, bad: 0 } };
    nbNext();
  };
  box.append(g1, g2, g3, count, start);
  $('#board').replaceChildren(box);
  refresh();
}
function nbNext() {
  const e = nb.queue.pop();
  if (!e) { const r = nb.res; return nbSetup(`수고하셨습니다! 이번 결과 ◎${r.best} ○${r.ok} ×${r.bad}`); }
  present(e.q, e.mode, e);
}

// ---------- 흐름 ----------
function next() { if (nb) nbNext(); else present(); }
const highlightTab = () => document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.mode === (nb ? 'notebook' : mode)));
function present(forced, forcedMode, entry) {
  replay = !!forced;
  if (forced && forcedMode !== mode) { mode = forcedMode; }
  if (forced) { highlightTab(); renderStats(); }
  const q = forced || pools[mode].pop();
  $('#result').hidden = true; $('#feedback').replaceChildren();
  answered = false; selected = null;
  $('#prompt').hidden = false;
  scrollTo({ top: 0, behavior: 'smooth' });
  if (!q) {
    cur = null; table = null; curHand = null;
    $('#strip').replaceChildren(); $('#prompt').replaceChildren(); $('#handwrap').replaceChildren(); $('#controls').replaceChildren();
    $('#board').replaceChildren(el('div', 'muted', '문제를 준비하는 중입니다… (로그 다운로드·AI 분석에 몇 초 걸립니다)'));
    refill();
    return;
  }
  cur = q;
  setStatus();
  const r = mode === 'tenpai' ? showTenpai(q) : mode === 'eff' ? showEff(q) : mode === 'danger' ? showDanger(q) : showDef(q);
  table = r.table;
  $('#board').replaceChildren(r.table.el);
  $('#strip').replaceChildren(scoreStrip(q));
  $('#prompt').innerHTML = r.prompt + (entry ? `<br><span class="sub nbinfo">📒 오답노트 · 이 문제 ${entry.history.length}회 시도 / ${entry.history.filter(h => h.grade !== 'best').length}회 오답 · 남은 ${nb.queue.length}문제</span>` : '');
  curHand = r.hand;
  $('#handwrap').replaceChildren(r.hand.el);
  $('#controls').replaceChildren(r.controls);
  layoutHand();
  if (pools[mode].length < 4) refill();
}

document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  if (b.dataset.mode === 'notebook') {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    return nbSetup();
  }
  nb = null; mode = b.dataset.mode;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  renderStats(); cur = null; next();
});
$('#next').onclick = next;
addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && answered && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); next(); } });

$('#custom').onsubmit = async e => {
  e.preventDefault();
  const raw = $('#logid').value.trim();
  const id = (raw.match(/log=([0-9a-z-]+)/i) || raw.match(/^([0-9a-z-]{10,})$/i) || [])[1];
  if (!id) return setStatus('로그 ID를 인식하지 못했습니다');
  try {
    setStatus('대국 불러오는 중…');
    custom = true;
    const out = await loadOne(id);
    for (const m of Object.keys(pools)) pools[m] = shuffle(out[m]);
    cur = null; next();
  } catch (err) { custom = false; setStatus('실패: ' + err.message); }
};
$('#random').onclick = () => { custom = false; for (const m of Object.keys(pools)) pools[m] = []; cur = null; next(); };

renderStats();
loadNotes();
next();
