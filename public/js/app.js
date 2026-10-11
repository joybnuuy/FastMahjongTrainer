import { isRed, doraKind } from './mjlog.js';
import { gradeAi } from './aiutil.js';

const $ = s => document.querySelector(s);
const SUIT = ['萬', '筒', '索'], SUITC = ['m', 'p', 's'], HON = ['東', '南', '西', '北', '白', '發', '中'];
const WIND = ['東', '南', '西', '北'];
const REL = ['나', '하가(오른쪽)', '대면', '상가(왼쪽)'];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ---------- 패 렌더링 ----------
function tile(kind, { red = false, cls = '' } = {}) {
  const t = el('div', 'tile ' + cls);
  if (kind < 27) {
    const s = Math.floor(kind / 9);
    t.classList.add(SUITC[s]);
    t.innerHTML = `<span class="n">${(kind % 9) + 1}</span><span class="s">${SUIT[s]}</span>`;
  } else {
    t.classList.add('z' + (kind - 27));
    t.innerHTML = `<span class="h">${HON[kind - 27]}</span>`;
  }
  if (red) t.classList.add('red');
  t.dataset.kind = kind;
  return t;
}
const tileId = (id, cls = '') => tile(id >> 2, { red: isRed(id), cls });
const sortIds = ids => ids.slice().sort((a, b) => a - b);

function riverEl(entries, size = 'sm') {
  const r = el('div', 'river');
  for (const e of entries) r.append(tileId(e.tile, size + (e.called ? ' called' : '') + (e.riichi ? ' rot' : '')));
  return r;
}
function meldsEl(melds, size = 'sm') {
  const w = el('div', 'melds');
  for (const m of melds) {
    const g = el('div', 'meld');
    for (const t of m.tiles) g.append(tileId(t, size + (m.type === 'ankan' ? ' dim' : '')));
    w.append(g);
  }
  return w;
}
function tilesRow(kinds, cls = 'xs') {
  const w = el('span');
  for (const k of kinds) w.append(tile(k, { cls }));
  return w;
}

// ---------- 상태 ----------
const stats = (() => { try { return JSON.parse(localStorage.getItem('mjp-stats-v1')) || {}; } catch { return {}; } })();
for (const m of ['eff', 'def', 'tenpai']) stats[m] ||= { n: 0, best: 0, ok: 0, streak: 0 };
const saveStats = () => { try { localStorage.setItem('mjp-stats-v1', JSON.stringify(stats)); } catch {} };
const MODE_NAME = { eff: '타패 효율', def: '리치 방어', tenpai: '텐파이 감' };

let mode = 'eff';
const pools = { eff: [], def: [], tenpai: [] };
let cur = null, answered = false, custom = false;
let loading = false;
const worker = new Worker('js/worker.js', { type: 'module' });
const pending = new Map();
worker.onmessage = e => { const f = pending.get(e.data.tag); pending.delete(e.data.tag); f && f(e.data); };
let tagSeq = 0;
const gen = (id, xml, ai) => new Promise(res => { const tag = ++tagSeq; pending.set(tag, res); worker.postMessage({ id, xml, tag, ai }); });

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function loadOne(id) {
  const r = await fetch('/api/game' + (id ? '?id=' + encodeURIComponent(id) : ''));
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  const d = await gen(j.id, j.xml, j.ai);
  if (d.error) throw new Error(d.error);
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
  $('#status').textContent = msg || `준비된 문제 — 효율 ${pools.eff.length} · 방어 ${pools.def.length} · 텐파이 ${pools.tenpai.length}${custom ? ' (지정 대국)' : ''}`;
}
function renderStats() {
  const s = stats[mode];
  const pct = s.n ? Math.round(((s.best + s.ok * 0.5) / s.n) * 100) : 0;
  $('#statline').textContent = `${MODE_NAME[mode]}: ${s.n}문제 · ◎ ${s.best} · ○ ${s.ok} · 점수율 ${pct}% · 연속 정답 ${s.streak}`;
}
function record(grade) {
  const s = stats[mode];
  s.n++;
  if (grade === 'best') { s.best++; s.streak++; } else if (grade === 'ok') { s.ok++; s.streak = 0; } else s.streak = 0;
  saveStats(); renderStats();
}

// ---------- 공통 보드 ----------
function boardEl(q, { hideOthersHand = true } = {}) {
  const v = q.view, w = el('div');
  const info = el('div', 'info');
  info.append(el('span', '', `<b>${WIND[v.kyoku >= 4 ? 1 : 0]}${(v.kyoku % 4) + 1}국</b> ${v.honba}본장 · 공탁 ${v.kyotaku}`));
  const di = el('span', '', '도라표시 ');
  for (const d of v.dora) di.append(tileId(d, 'sm'));
  info.append(di);
  info.append(el('span', '', `남은 패산 <b>${Math.max(v.wall, 0)}</b>`));
  info.append(el('span', '', `내 자풍 <b>${WIND[(v.me - v.oya + 4) % 4]}</b>`));
  w.append(info);
  for (let rel = 0; rel < 4; rel++) {
    const p = (v.me + rel) % 4;
    const row = el('div', 'seat');
    const who = el('div', 'who');
    who.innerHTML = `<b>${REL[rel]}</b> · ${WIND[(p - v.oya + 4) % 4]}${p === v.oya ? '(친)' : ''}<br>${(v.scores[p]).toLocaleString()}점${v.riichi[p] ? '<span class="badge">리치</span>' : ''}`;
    const body = el('div', 'rowwrap');
    body.append(riverEl(v.rivers[p]));
    if (v.melds[p].length) body.append(meldsEl(v.melds[p]));
    row.append(who, body);
    w.append(row);
  }
  return w;
}

function handEl(q, onPick) {
  const wrap = el('div', 'handrow');
  const rest = q.drawn != null ? q.hand.filter((t, i, a) => t !== q.drawn) : q.hand;
  for (const id of sortIds(rest)) wrap.append(handTile(id, onPick));
  if (q.drawn != null) { const t = handTile(q.drawn, onPick); t.classList.add('draw'); wrap.append(t); }
  return wrap;
}
function handTile(id, onPick) {
  const t = tileId(id, onPick ? 'click' : '');
  if (onPick) t.onclick = () => onPick(id >> 2, t);
  return t;
}
function meldsOfMe(q) { return q.view.melds[q.view.me].length ? meldsEl(q.view.melds[q.view.me], '') : null; }

const shLabel = s => s < 0 ? '화료' : s === 0 ? '텐파이' : s + '샨텐';
const gameLink = q => `<a target="_blank" rel="noreferrer" href="https://tenhou.net/0/?log=${q.meta.id}&tw=${q.view.me}">텐호우에서 이 대국 보기</a>`;
const nameOf = (q, p) => q.meta.names[p] || '?';

function finish(grade, fbNodes) {
  answered = true;
  record(grade);
  const fb = $('#feedback');
  fb.hidden = false; fb.replaceChildren(...fbNodes);
  $('#actions').hidden = false;
  $('#next').focus();
}


// ---------- Mortal 기반 피드백 ----------
const pctS = x => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
const probBar = p => `<span class="bar ai" style="width:${Math.round(p * 120)}px"></span>${pctS(p)}`;
const BADGE = { best: '◎ Mortal과 같은 선택', ok: '○ 허용 범위 (Mortal도 꽤 고려하는 패)', bad: '× Mortal은 선호하지 않는 선택' };

function effFeedbackAi(q, kind) {
  const grade = gradeAi(q.opts, kind);
  const best = q.opts[0], mine = q.opts.find(o => o.kind === kind);
  const tbl = el('table');
  tbl.innerHTML = '<tr><th>버림</th><th>Mortal 선택 확률</th><th>Q 격차</th><th>효율(샨텐·우케이레)</th><th></th></tr>';
  for (const o of q.opts) {
    if (o.p < 0.005 && o.kind !== kind && o.kind !== q.actual) continue;
    const tr = el('tr', (o.kind === kind ? 'mine ' : '') + (o.kind === q.actual ? 'act' : ''));
    const t0 = el('td'); t0.append(tile(o.kind, { cls: 'sm', red: o.red }));
    tr.append(t0, el('td', '', probBar(o.p)), el('td', 'muted', o.gap === 0 ? '—' : '-' + o.gap.toFixed(2)),
      el('td', 'muted', `${shLabel(o.sh)}${o.sh === q.opts.reduce((m, x) => Math.min(m, x.sh), 9) ? ' · ' + o.ue + '장' : ''}`),
      el('td', 'muted', (o.rank === 0 ? '★ Mortal 추천' : '') + (o.kind === kind ? ' · 내 선택' : '') + (o.kind === q.actual ? ' · 실제 플레이어' : '')));
    tbl.append(tr);
  }
  const ban = el('div', `banner ${grade}`, BADGE[grade]);
  const lines = [];
  lines.push(`내 선택 확률 ${pctS(mine.p)} (Q 격차 -${mine.gap.toFixed(2)}) · Mortal 추천 ${pctS(best.p)}`);
  if (q.pReach >= 0.05) lines.push(`이 손에서 Mortal은 <b>리치</b>를 ${pctS(q.pReach)} 확률로 선택합니다 (아래 확률은 리치/다마 합산).`);
  const note = el('div', 'note', `${lines.join('<br>')}<br>Mortal S42 (Q값을 softmax 변환한 확률). Q 격차 0.1 이내 ◎, 0.7 이내 ○. ${gameLink(q)}`);
  return { grade, nodes: [ban, tbl, note] };
}

function defFeedbackAi(q, kind) {
  const grade = gradeAi(q.opts, kind);
  const mine = q.opts.find(o => o.kind === kind);
  const tbl = el('table');
  tbl.innerHTML = '<tr><th>버림</th><th>Mortal 선택 확률</th><th>추정 방총률(휴리스틱)</th><th>근거</th><th>실제</th></tr>';
  for (const o of q.opts) {
    if (o.p < 0.005 && o.kind !== kind && o.kind !== q.actual && !o.ron) continue;
    const tr = el('tr', (o.kind === kind ? 'mine ' : '') + (o.kind === q.actual ? 'act' : ''));
    const t0 = el('td'); t0.append(tile(o.kind, { cls: 'sm', red: o.red }));
    tr.append(t0, el('td', '', probBar(o.p) + (o.rank === 0 ? ' <span class="muted">★</span>' : '')),
      el('td', 'muted', (o.est * 100).toFixed(1) + '%'),
      el('td', '', o.tags.map(t => `<span class="tag">${t}</span>`).join('') || '<span class="muted">정보 없음</span>'),
      el('td', '', (o.ron ? '<span class="tag ron">론!</span>' : '<span class="muted">안전</span>') + (o.kind === q.actual ? ' <span class="muted">· 실제 플레이어</span>' : '')));
    tbl.append(tr);
  }
  const ban = el('div', `banner ${grade}`, BADGE[grade] + (mine.ron ? ' — 단, 이 패는 실제로 론 당합니다 💥' : ''));
  const rv = el('div', 'note');
  for (const r of q.riichers) {
    const box = el('div', 'muted', `${REL[(r.r - q.view.me + 4) % 4]} (${nameOf(q, r.r)}) 대기: `);
    box.append(tilesRow(r.waits, 'xs'));
    if (r.furiten) box.append(el('span', 'tag', '후리텐 — 론 불가'));
    const h = el('div'); for (const id of sortIds(r.hand)) h.append(tileId(id, 'xs'));
    box.append(h); rv.append(box);
  }
  rv.append(el('div', 'note', `내 손패는 ${shLabel(q.myShanten)}. Mortal은 밀기/접기까지 포함해 판단합니다(★ = Mortal 추천). 방총률은 현물·스지·벽 기반 휴리스틱 추정치입니다. ${gameLink(q)}`));
  return { grade, nodes: [ban, tbl, rv] };
}

// ---------- ① 타패 효율 ----------
function showEff(q) {
  const wrap = el('div');
  wrap.append(el('div', 'prompt', `${q.turn}순째 · 어떤 패를 버리겠습니까? (상대 패는 모른다고 가정${q.ai ? ' · Mortal AI 기준' : ' · 효율 기준'})`));
  const nm = meldsOfMe(q);
  const hr = handEl(q, (kind, node) => {
    if (answered) return;
    node.classList.add('pick');
    if (q.ai) { const r = effFeedbackAi(q, kind); return finish(r.grade, r.nodes); }
    const grade = gradeOf(q, kind);
    const rows = q.opts.map(o => {
      const tr = el('tr', (o.kind === kind ? 'mine ' : '') + (o.kind === q.actual ? 'act' : ''));
      const td0 = el('td'); td0.append(tile(o.kind, { cls: 'sm' }));
      tr.append(td0);
      tr.append(el('td', '', shLabel(o.shanten)));
      const dr = el('td'); dr.append(el('span', '', o.shanten === q.opts[0].shanten ? `${o.ue}장 ` : '—'));
      if (o.shanten === q.opts[0].shanten) dr.append(tilesRow(o.draws.map(d => d.k)));
      tr.append(dr);
      tr.append(el('td', 'muted', (o.rank === 0 ? '★ 추천' : '') + (o.kind === kind ? ' · 내 선택' : '') + (o.kind === q.actual ? ' · 실제 플레이어' : '')));
      return tr;
    });
    const tbl = el('table');
    tbl.innerHTML = '<tr><th>버림</th><th>버린 후</th><th>우케이레(진행 패)</th><th></th></tr>';
    tbl.append(...rows);
    const best = q.opts[0], mine = q.opts.find(o => o.kind === kind);
    const msg = { best: '◎ 정답', ok: '○ 허용 범위', bad: '× 비효율' }[grade];
    const ban = el('div', `banner ${grade}`, msg);
    const why = el('div', 'muted',
      grade === 'best' ? `추천 타패와 같거나 사실상 동급입니다 (${shLabel(mine.shanten)}, 우케이레 ${mine.ue}장).`
        : `내 선택: ${shLabel(mine.shanten)}${mine.shanten === best.shanten ? ` · ${mine.ue}장` : ''} → 추천: ${shLabel(best.shanten)} · ${best.ue}장` +
        (best.next != null && mine.shanten === best.shanten ? ` (한 수 앞 평균 ${best.next.toFixed(1)}장)` : ''));
    const note = el('div', 'note', `평가: 샨텐 → 우케이레(장수) → 한 수 앞 잠재력 순. 도라·역·타점·상대 동향은 반영하지 않은 '효율' 기준입니다. ${gameLink(q)} · ${nameOf(q, q.view.me)}`);
    finish(grade, [ban, why, tbl, note]);
  });
  wrap.append(hr);
  if (nm) wrap.append(nm);
  return wrap;
}
function gradeOf(q, kind) {
  const best = q.opts[0], o = q.opts.find(x => x.kind === kind);
  const scoreOf = x => x.score;
  if (o === best) return 'best';
  if (o.shanten === best.shanten && o.deep && best.deep && o.next != null && 0.6 * o.ue + 0.4 * o.next >= 0.6 * best.ue + 0.4 * best.next - 0.8) return 'best';
  if (o.shanten === best.shanten && o.ue >= 0.9 * best.ue) return 'ok';
  return 'bad';
}

// ---------- ② 리치 방어 ----------
function showDef(q) {
  const wrap = el('div');
  const rs = q.riichers.map(r => REL[(r.r - q.view.me + 4) % 4]).join(', ');
  wrap.append(el('div', 'prompt', `${rs} 리치 · 내 손패는 ${shLabel(q.myShanten)} — 어떤 패를 버리겠습니까? (손에 론패가 있습니다 — 밀지 접을지도 판단)`));
  const hr = handEl(q, (kind, node) => {
    if (answered) return;
    node.classList.add('pick');
    if (q.ai) { const r = defFeedbackAi(q, kind); return finish(r.grade, r.nodes); }
    const minP = q.opts[0].p, mine = q.opts.find(o => o.kind === kind);
    let grade = mine.p <= minP + 0.004 ? 'best' : mine.p <= minP + 0.02 ? 'ok' : 'bad';
    if (mine.ron) grade = 'bad';
    const pct = x => (x * 100).toFixed(1) + '%';
    const tbl = el('table');
    tbl.innerHTML = '<tr><th>버림</th><th>추정 방총률</th><th>근거</th><th>실제</th></tr>';
    for (const o of q.opts) {
      const tr = el('tr', (o.kind === kind ? 'mine ' : '') + (o.kind === q.actual ? 'act' : ''));
      const t0 = el('td'); t0.append(tile(o.kind, { cls: 'sm' }));
      const t1 = el('td', '', `<span class="bar" style="width:${Math.min(o.p * 400, 80)}px"></span>${pct(o.p)}`);
      const t2 = el('td', '', o.tags.map(t => `<span class="tag">${t}</span>`).join('') || '<span class="muted">정보 없음</span>');
      const t3 = el('td', '', (o.ron ? '<span class="tag ron">론!</span>' : '<span class="muted">안전</span>') + (o.kind === q.actual ? ' <span class="muted">· 실제 플레이어</span>' : ''));
      tr.append(t0, t1, t2, t3);
      tbl.append(tr);
    }
    const ban = el('div', `banner ${grade}`,
      mine.ron ? '💥 방총! 이 패는 실제로 론 당합니다' :
        grade === 'best' ? '◎ 안전한 선택' : grade === 'ok' ? '○ 차선 (결과는 안전했지만 더 안전한 패가 있음)' : '× 위험한 선택 (이번엔 운 좋게 안 맞음)');
    const rv = el('div', 'note');
    rv.append(document.createTextNode('리치자 패: '));
    for (const r of q.riichers) {
      const box = el('div', 'muted', `${REL[(r.r - q.view.me + 4) % 4]} (${nameOf(q, r.r)}) 대기: `);
      box.append(tilesRow(r.waits, 'xs'));
      if (r.furiten) box.append(el('span', 'tag', '후리텐 — 론 불가'));
      const h = el('div'); for (const id of sortIds(r.hand)) h.append(tileId(id, 'xs'));
      box.append(h);
      rv.append(box);
    }
    rv.append(el('div', 'note', `방총률은 현물·스지·벽·자패 잔여·도라만 쓴 휴리스틱 추정치입니다. ${gameLink(q)}`));
    finish(grade, [ban, tbl, rv]);
  });
  wrap.append(hr);
  const nm = meldsOfMe(q); if (nm) wrap.append(nm);
  return wrap;
}

// ---------- ③ 텐파이 감 ----------
function showTenpai(q) {
  const wrap = el('div');
  wrap.append(el('div', 'prompt', '리치하지 않은 상대는 지금 텐파이일까요? (타패 직후 · 후로·강·상황으로 판단)'));
  wrap.append(el('div', 'muted', '내 손패(참고):'));
  const h = el('div', 'handrow'); for (const id of sortIds(q.hand)) h.append(tileId(id, 'sm')); wrap.append(h);
  const cards = el('div', 'cards'); cards.style.marginTop = '10px';
  const guess = {};
  const cardOf = {};
  for (const pl of q.players) {
    const card = el('div', 'card');
    const rel = (pl.p - q.view.me + 4) % 4;
    card.innerHTML = `<h3>${REL[rel]} · ${WIND[(pl.p - q.view.oya + 4) % 4]} · ${nameOf(q, pl.p)}${pl.riichi ? '<span class="badge">리치</span>' : ''}</h3>`;
    if (pl.riichi) card.append(el('div', 'muted', '리치 = 텐파이 (판정 제외)'));
    else {
      const tg = el('div', 'toggle');
      for (const [val, label] of [[true, '텐파이'], [false, '노텐']]) {
        const b = el('button', '', label);
        b.onclick = () => { if (answered) return; guess[pl.p] = val; [...tg.children].forEach(c => c.classList.toggle('sel', c === b)); sub.disabled = !q.players.every(x => x.riichi || guess[x.p] !== undefined); };
        tg.append(b);
      }
      card.append(tg);
    }
    cardOf[pl.p] = card;
    cards.append(card);
  }
  // 각 카드에 강/후로 표시
  for (const pl of q.players) {
    const card = cardOf[pl.p], body = el('div');
    body.append(riverEl(q.view.rivers[pl.p]));
    if (q.view.melds[pl.p].length) body.append(meldsEl(q.view.melds[pl.p]));
    card.insertBefore(body, card.children[1]);
  }
  wrap.append(cards);
  const infoBar = boardInfo(q);
  wrap.prepend(infoBar);
  const sub = el('button', 'primary', '정답 확인'); sub.disabled = true; sub.style.marginTop = '10px';
  sub.onclick = () => {
    if (answered) return;
    let right = 0, asked = 0;
    for (const pl of q.players) {
      if (pl.riichi) continue;
      asked++;
      const ok = guess[pl.p] === pl.tenpai;
      if (ok) right++;
      const card = cardOf[pl.p];
      card.classList.add(ok ? 'right' : 'wrong');
      const r = el('div', 'muted', `${ok ? '✓' : '✗'} 실제: <b>${pl.tenpai ? '텐파이' : '노텐'}</b>${pl.tenpai ? ' · 대기 ' : ''}`);
      if (pl.tenpai) r.append(tilesRow(pl.waits, 'xs'));
      const hh = el('div'); for (const id of sortIds(pl.hand)) hh.append(tileId(id, 'xs'));
      r.append(hh);
      card.append(r);
    }
    sub.disabled = true;
    const grade = right === asked ? 'best' : 'bad';
    const ban = el('div', `banner ${grade}`, `${right}/${asked} 정답`);
    finish(grade, [ban, el('div', 'note', `텐파이 = 실제 손패 기준(역 유무 무관). ${gameLink(q)}`)]);
  };
  wrap.append(sub);
  return wrap;
}
function boardInfo(q) {
  const v = q.view, info = el('div', 'info');
  info.append(el('span', '', `<b>${WIND[v.kyoku >= 4 ? 1 : 0]}${(v.kyoku % 4) + 1}국</b> ${v.honba}본장 · 공탁 ${v.kyotaku}`));
  const di = el('span', '', '도라표시 '); for (const d of v.dora) di.append(tileId(d, 'sm')); info.append(di);
  info.append(el('span', '', `남은 패산 <b>${Math.max(v.wall, 0)}</b>`));
  info.append(el('span', '', `내 자풍 <b>${WIND[(v.me - v.oya + 4) % 4]}</b> · ${v.scores[v.me].toLocaleString()}점`));
  return info;
}

// ---------- 흐름 ----------
function next() {
  const q = pools[mode].pop();
  $('#feedback').hidden = true; $('#actions').hidden = true;
  $('#feedback').replaceChildren();
  answered = false;
  if (!q) {
    cur = null;
    $('#board').replaceChildren(el('div', 'muted', '문제를 준비하는 중입니다… (로그 다운로드·분석에 몇 초 걸립니다)'));
    $('#work').replaceChildren();
    refill();
    return;
  }
  cur = q;
  setStatus();
  if (mode === 'tenpai') {
    $('#board').replaceChildren();
    $('#work').replaceChildren(showTenpai(q));
  } else {
    $('#board').replaceChildren(boardEl(q));
    $('#work').replaceChildren(mode === 'eff' ? showEff(q) : showDef(q));
  }
  if (pools[mode].length < 4) refill();
}

document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  mode = b.dataset.mode;
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
next();
