// 실제 마작 테이블 렌더러: 4좌석(회전), 중앙 정보, 6장×3줄 버림패, 후로, 패산 덱
import { tileEl, backEl, WIND_KIND } from './tiles.js';

const isRed = id => id === 16 || id === 52 || id === 88;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const faceId = (id, cls) => tileEl(id >> 2, { red: isRed(id), cls });
const sortIds = ids => ids.slice().sort((a, b) => a - b);
const LAYER_ROT = [0, -90, 180, 90]; // 나 / 하가(오른쪽) / 대면 / 상가(왼쪽)
const REL_NAME = ['나', '하가', '대면', '상가'];

// 눕힌 패 칸 (가로 점유가 패 높이만큼)
function sideCell(id, cls, extra) {
  const c = el('div', 'cell side ' + cls);
  c.append(faceId(id, cls));
  if (extra) c.classList.add(extra);
  return c;
}

// ---- 버림패: 표시되는 패 기준 6장씩, 3줄째는 이어서. 울린 패는 제거, 리치 선언패는 눕힘 ----
function riverEl(entries) {
  const shown = [];
  let carry = false; // 리치 선언패가 울렸으면 다음 패를 눕힘
  for (const e of entries) {
    const isRiichi = e.riichi || carry;
    if (e.called) { carry = isRiichi; continue; }
    carry = false;
    shown.push({ tile: e.tile, riichi: isRiichi });
  }
  const river = el('div', 'river');
  const rows = [shown.slice(0, 6), shown.slice(6, 12), shown.slice(12)];
  for (const r of rows) {
    if (!r.length) continue;
    const row = el('div', 'rrow');
    for (const e of r) row.append(e.riichi ? sideCell(e.tile, 't-rv') : faceId(e.tile, 't-rv'));
    river.append(row);
  }
  return river;
}

// ---- 후로: 울린 방향에 따라 눕힌 패 위치가 달라짐 ----
function meldEl(m, actor, size) {
  const g = el('div', 'meld');
  const rel = m.from == null ? 3 : (m.from - actor + 4) % 4; // 1: 하가 2: 대면 3: 상가
  const sidePos = rel === 3 ? 0 : rel === 2 ? 1 : 2;
  if (m.type === 'ankan') {
    const t = m.tiles;
    g.append(backEl(size), faceId(t[1], size), faceId(t[2], size), backEl(size));
    return g;
  }
  const others = m.tiles.filter(t => t !== m.called);
  if (m.type === 'chi') {
    const o = sortIds(others);
    g.append(sideCell(m.called, size), faceId(o[0], size), faceId(o[1], size));
    return g;
  }
  if (m.type === 'pon') {
    const o = sortIds(others);
    const parts = [];
    let k = 0;
    for (let i = 0; i < 3; i++) parts.push(i === sidePos ? sideCell(m.called, size) : faceId(o[k++], size));
    g.append(...parts);
    return g;
  }
  if (m.type === 'kakan') {
    const o = sortIds(others); // 3장: 2장 정립 + 1장은 가칸으로 눕힌 패 위에 포갬
    const added = o.pop();
    const stack = el('div', 'stack');
    stack.append(sideCell(added, size), sideCell(m.called, size));
    const parts = [];
    let k = 0;
    for (let i = 0; i < 3; i++) parts.push(i === sidePos ? stack : faceId(o[k++], size));
    g.append(...parts);
    return g;
  }
  // 대명깡: 4장
  const o = sortIds(others);
  const pos = rel === 3 ? 0 : rel === 2 ? 1 : 3;
  const parts = [];
  let k = 0;
  for (let i = 0; i < 4; i++) parts.push(i === pos ? sideCell(m.called, size) : faceId(o[k++], size));
  g.append(...parts);
  return g;
}

function dealerBadge() { return el('span', 'dealer', '親'); }

let fitObs = null;

export function renderTable(q, opts = {}) {
  const v = q.view, me = v.me;
  const wrap = el('div', 'table-wrap');
  // showMine: 가로 모드처럼 여유가 있으면 내 손패도 테이블에 (표시 전용) 그린다. 아니면 아래를 잘라낸 컴팩트 테이블
  const TH = opts.showMine ? 720 : 640;
  const table = el('div', 'table' + (opts.showMine ? '' : ' compact'));
  const handAreas = {};

  // 중앙 정보
  const center = el('div', 'center');
  const roundWind = v.kyoku >= 4 ? 28 : 27;
  const rl = el('div', 'rl');
  rl.append(tileEl(roundWind, { cls: 't-dora' }), el('span', 'rn', `${(v.kyoku % 4) + 1}局`));
  const hb = el('div', 'hb', `${v.honba}본장 · 공탁 ${v.kyotaku}`);
  const dora = el('div', 'dora');
  for (let i = 0; i < 5; i++) dora.append(i < v.dora.length ? faceId(v.dora[i], 't-dora') : backEl('t-dora'));
  const wall = el('div', 'wall', `남은 패산 <b>${Math.max(v.wall, 0)}</b>`);
  center.append(rl, hb, dora, wall);
  table.append(center);

  for (let rel = 0; rel < 4; rel++) {
    const p = (me + rel) % 4;
    const layer = el('div', 'seat-layer');
    layer.style.transform = `rotate(${LAYER_ROT[rel]}deg)`;

    // 좌석 표시: 자풍 패(+親)를 중앙 칸 가장자리에, 좌석 방향대로 회전
    const panel = el('div', 'panel' + (v.riichi[p] ? ' is-riichi' : ''));
    const seatWind = (p - v.oya + 4) % 4;
    panel.append(tileEl(WIND_KIND[seatWind], { cls: 't-meld' }));
    if (p === v.oya) panel.append(dealerBadge());
    layer.append(panel);

    if (v.riichi[p]) layer.append(el('div', 'rstick'));
    layer.append(riverEl(v.rivers[p]));

    if (rel !== 0 || opts.showMine) { // 컴팩트일 때 내 손패/후로는 테이블 밖 손패 바(renderHandBar)에 표시
      const hand = el('div', 'hand-area' + (rel === 0 ? ' mine' : ''));
      handAreas[p] = { hand, rel, p };
      fillHand(q, hand, p, rel, opts, opts.reveal?.[p]);
      layer.append(hand);
    }
    table.append(layer);
  }
  wrap.append(table);

  // 호스트 영역(가로·세로 모두)에 맞춰 축소/확대
  function fit() {
    const host = opts.host || wrap.parentElement;
    const W = host?.clientWidth || 720, H = host?.clientHeight || TH;
    const sc = Math.min(W / 720, H / TH, 1.35);
    table.style.transform = `scale(${sc})`;
    wrap.style.width = 720 * sc + 'px';
    wrap.style.height = TH * sc + 'px';
  }
  if (fitObs) fitObs.disconnect();
  fitObs = new ResizeObserver(fit);
  if (opts.host) fitObs.observe(opts.host);
  requestAnimationFrame(fit);

  const api = {
    el: wrap,
    revealed: { ...(opts.reveal || {}) },
    // 내가 고른 패를 테이블 위 내 손패에도 표시(손패 바와 동기화)
    markPick(id) {
      wrap.querySelectorAll('.hand-area .tile.pick').forEach(t => t.classList.remove('pick'));
      if (id != null) wrap.querySelector(`.hand-area .tile[data-id="${id}"]`)?.classList.add('pick');
    },
    // 정답 공개: 해당 플레이어의 손패를 앞면으로 뒤집음
    reveal(map) {
      Object.assign(api.revealed, map);
      for (const [p, ids] of Object.entries(map)) {
        const h = handAreas[p];
        if (!h) continue;
        h.hand.replaceChildren();
        fillHand(q, h.hand, +p, h.rel, { ...opts, onPick: null }, ids);
        h.hand.classList.add('revealed');
      }
    },
  };
  return api;
}

function fillHand(q, area, p, rel, opts, revealIds) {
  const v = q.view;
  const melds = v.melds[p];
  if (rel === 0) {
    const draw = q.drawn;
    const rest = draw != null ? q.hand.filter(t => t !== draw) : q.hand;
    const row = el('div', 'hrow');
    for (const id of sortIds(rest)) row.append(handTile(id, opts));
    if (draw != null) { const t = handTile(draw, opts); t.classList.add('draw'); row.append(t); }
    area.append(row);
  } else {
    const row = el('div', 'hrow');
    if (revealIds) for (const id of sortIds(revealIds)) row.append(faceId(id, 't-opp'));
    // 상대 손패(뒷면)는 그리지 않는다 — 어차피 보이지 않는 정보. 후로와 정답 공개 때의 앞면 손패만 표시
    area.append(row);
  }
  if (melds.length) {
    const mw = el('div', 'melds');
    for (const m of melds) mw.append(meldEl(m, p, rel === 0 ? 't-meld' : 't-meldo'));
    area.append(mw);
  }
}

function handTile(id, opts) {
  const t = faceId(id, 't-hand');
  t.dataset.id = id;
  if (opts.onPick) {
    t.classList.add('click');
    t.onclick = () => opts.onPick(id >> 2, t, id);
  }
  return t;
}

// 내 손패 바: 쯔모패 분리 + 후로. 크기는 CSS 변수 --hw(패 너비)로 조절
export function renderHandBar(q, opts = {}) {
  const bar = el('div', 'handbar');
  const row = el('div', 'hrow');
  const draw = q.drawn;
  const rest = draw != null ? q.hand.filter(t => t !== draw) : q.hand;
  const barTile = id => {
    const t = faceId(id, 't-bar');
    t.dataset.id = id;
    if (opts.onPick) { t.classList.add('click'); t.onclick = () => opts.onPick(id >> 2, t, id); }
    return t;
  };
  if (opts.unique) {            // 같은 종류는 한 장만 (위험패 찾기: 종류 단위로 고르기)
    const seen = new Set();
    for (const id of sortIds(q.hand)) if (!seen.has(id >> 2)) { seen.add(id >> 2); row.append(barTile(id)); }
  } else {
    for (const id of sortIds(rest)) row.append(barTile(id));
    if (draw != null) { const t = barTile(draw); t.classList.add('draw'); row.append(t); }
  }
  bar.append(row);
  const melds = q.view.melds[q.view.me];
  if (melds.length) {
    const mw = el('div', 'melds');
    for (const m of melds) mw.append(meldEl(m, q.view.me, 't-bmeld'));
    bar.append(mw);
  }
  return { el: bar, tiles: opts.unique ? new Set(q.hand.map(t => t >> 2)).size : q.hand.length };
}
