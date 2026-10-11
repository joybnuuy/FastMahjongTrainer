// V1식 보드: 정보줄 + 좌석별 행(이름·점수·버림패·후로). V4 의 table.js 와 같은 인터페이스(renderTable/renderHandBar)라서
// app.js 는 한 줄도 바꾸지 않고 import map 으로 이 모듈로 교체된다 (v1/index.html 참고).
import { tileEl } from '../../v4/js/tiles.js';
// 손패 선택 바는 V4 그대로 쓴다 (선택·제출·터치 동작이 여기에 있음). ?orig 로 import map 의 교체 대상(table.js)과 구분한다.
export { renderHandBar } from '../../v4/js/table.js?orig';

const WIND = ['東', '南', '西', '北'];
const REL = ['나', '하가(오른쪽)', '대면', '상가(왼쪽)'];
const isRed = id => id === 16 || id === 52 || id === 88;
const sortIds = ids => ids.slice().sort((a, b) => a - b);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const faceId = (id, cls) => tileEl(id >> 2, { red: isRed(id), cls });

// 버림패: V1처럼 단순 흐름. 울려 간 패는 흐리게, 리치 선언패는 눕힘
function riverEl(entries) {
  const r = el('div', 'v1river');
  for (const e of entries) r.append(faceId(e.tile, 't-river' + (e.called ? ' v1-called' : '') + (e.riichi ? ' v1-rot' : '')));
  return r;
}

// 후로: 그룹별로 묶어서 표시 (안깡은 흐리게)
function meldsEl(melds) {
  const w = el('div', 'v1melds');
  for (const m of melds) {
    const g = el('div', 'v1meld');
    for (const t of m.tiles) g.append(faceId(t, 't-meld' + (m.type === 'ankan' ? ' v1-dim' : '')));
    w.append(g);
  }
  return w;
}

export function renderTable(q, opts = {}) {
  const v = q.view, me = v.me;
  const root = el('div', 'v1board');

  // 정보줄: 국/본장/공탁 · 도라표시 · 남은 패산 · 내 자풍
  const info = el('div', 'v1info');
  info.append(el('span', '', `<b>${WIND[v.kyoku >= 4 ? 1 : 0]}${(v.kyoku % 4) + 1}국</b> ${v.honba}본장 · 공탁 ${v.kyotaku}`));
  const di = el('span', '', '도라표시 ');
  for (let i = 0; i < 5; i++) if (i < v.dora.length) di.append(faceId(v.dora[i], 't-dora'));
  info.append(di);
  info.append(el('span', '', `남은 패산 <b>${Math.max(v.wall, 0)}</b>`));
  info.append(el('span', '', `내 자풍 <b>${WIND[(me - v.oya + 4) % 4]}</b>`));
  root.append(info);

  const reveals = {};
  for (let rel = 0; rel < 4; rel++) {
    const p = (me + rel) % 4;
    const row = el('div', 'v1seat');
    const who = el('div', 'v1who');
    who.innerHTML = `<b>${REL[rel]}</b> · ${WIND[(p - v.oya + 4) % 4]}${p === v.oya ? '(친)' : ''}<br>${v.scores[p].toLocaleString()}점${v.riichi[p] ? '<span class="v1badge">리치</span>' : ''}`;
    const body = el('div', 'v1body');
    const line = el('div', 'v1line');
    line.append(riverEl(v.rivers[p]));
    if (v.melds[p].length) line.append(meldsEl(v.melds[p]));
    const reveal = el('div', 'v1reveal'); reveal.hidden = true;   // 정답 확인 후 공개되는 손패가 들어갈 자리
    reveals[p] = reveal;
    body.append(line, reveal);
    row.append(who, body);
    root.append(row);
  }

  const api = {
    el: root,
    revealed: {},
    markPick() { /* V1 보드에는 내 손패가 없다 (선택은 손패 바에서) */ },
    // 정답 공개: 해당 플레이어의 손패를 이 좌석 행 아래에 앞면으로 보여 준다
    reveal(map) {
      Object.assign(api.revealed, map);
      for (const [p, ids] of Object.entries(map)) {
        const slot = reveals[p];
        if (!slot) continue;
        slot.replaceChildren(el('span', 'v1rlabel', '손패 공개'), ...sortIds(ids).map(id => faceId(id, 't-opp')));
        slot.hidden = false;
      }
    },
  };
  if (opts.reveal) api.reveal(opts.reveal);
  return api;
}
