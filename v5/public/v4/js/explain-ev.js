// 비동기로 계산된 화료확률/기대타점 · 푸시/풀 결과를 해설 화면의 슬롯에 채운다
import { tileEl } from './tiles.js';
import { STATS } from './dangerTable.js';
import { EFF_AGREE, PUSHFOLD_AGREE } from './metrics.js';
import { mortalMode, PUSH_HORIZON, PUSH_PARAMS } from './pushfold.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const tileK = (k, cls) => tileEl(k, { cls });
const TILE_NAME = k => k >= 27 ? '東南西北白發中'[k - 27] : (k % 9 + 1) + '만통삭'[Math.floor(k / 9)];
const shLabel = s => s < 0 ? '화료' : s === 0 ? '텐파이' : s + '샨텐';
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const pts = x => Math.round(x).toLocaleString() + '점';
const marks = (kind, roles) => roles.filter(r => r.kind === kind).map(r => r.label).join(' · ');

export function fillEffEv(slot, q, res, chosenKind) {
  const { rows, local } = res;
  slot.className = 'ev-slot';
  slot.replaceChildren();
  slot.append(el('h5', '', '📊 화료확률 · 기대타점 (내 손 단독 계산)'));
  const L = new Map(local.map(o => [o.kind, o]));
  const minLocalSh = Math.min(...local.map(o => o.sh));
  const mortal = q.opts[0].kind;
  const effBest = local.find(o => o.rank === 0);
  const evBest = rows[0];
  const roles = [{ kind: chosenKind, label: '내 선택' }, { kind: mortal, label: 'Mortal' }, { kind: q.actual, label: '실제' },
    { kind: evBest.kind, label: 'EV 1위' }, { kind: effBest.kind, label: '효율평가 1위' }];
  const T = Math.max(1, Math.min(8, Math.floor((q.view.wall ?? 40) / 4)));
  const tbl = el('table');
  tbl.innerHTML = `<tr><th>버림</th><th>샨텐</th><th>유효패</th><th>한 수 앞<br>평균 유효패</th><th>화료확률<br>(${T}순 내)</th><th>기대득점</th><th></th></tr>`;
  for (const r of rows) {
    const l = L.get(r.kind);
    const tr = el('tr', (r.kind === chosenKind ? 'mine ' : '') + (r.kind === q.actual ? 'act' : ''));
    const t0 = el('td'); t0.append(tileK(r.kind, 't-river'));
    tr.append(t0, el('td', '', shLabel(r.sh)), el('td', '', l && l.sh === minLocalSh && l.sh >= 0 ? l.ue + '장' : '—'),
      el('td', '', l && l.next != null ? l.next.toFixed(1) + '장' : '—'), el('td', '', pct(r.p)), el('td', '', pts(r.ev)),
      el('td', 'muted', marks(r.kind, roles)));
    tbl.append(tr);
  }
  slot.append(tbl);
  const mine = rows.find(r => r.kind === chosenKind), mr = rows.findIndex(r => r.kind === chosenKind) + 1;
  const ul = el('ul', 'sum');
  ul.append(el('li', '', `기대득점 1위는 <b>${TILE_NAME(evBest.kind)}</b>(${pts(evBest.ev)}, 화료확률 ${pct(evBest.p)}) — 내 선택은 ${mr}위/${rows.length}` +
    (mine && mine !== evBest ? `, 1위 대비 <b>${pts(mine.ev - evBest.ev)}</b>` : '') + '.'));
  const mrow = rows.findIndex(r => r.kind === mortal) + 1;
  if (mrow) ul.append(el('li', '', `Mortal 추천(${TILE_NAME(mortal)})의 기대득점 순위는 ${mrow}위입니다${mrow === 1 ? ' — Mortal이 속도·타점 면에서도 앞서는 선택.' : ' — Mortal이 이 지표 1위가 아닌 수를 택했으므로, 이 지표로 설명되지 않는 이유(수비·모양 변화·순위 상황 등)가 있을 수 있습니다.'}`));
  slot.append(ul);
  slot.append(el('div', 'note', `화료확률 = ${T}번의 내 쯔모 안에 쯔모/론으로 화료할 확률(멘젠이면 리치 가정, 론 기회는 쯔모의 ${(STATS?.ronRatio ?? 1.5).toFixed(2)}배 — 로그 실측 비율). 샨텐을 줄이는 쯔모만 '진행'으로 보고 나머지는 쯔모기리로 취급하므로 <b>모양 변화(好形変化)의 이득은 과소평가</b>하고, 상대의 방해·방어는 반영하지 않습니다. 기대득점은 역·부수·도라를 직접 계산한 점수(우라도라·일발 제외)를 확률로 가중한 값입니다.`));
  slot.append(el('div', 'note', `<b>이 지표들이 Mortal과 얼마나 맞나</b> (효율 문제 ${EFF_AGREE.n}개, Mortal 1순위와 정확히 일치한 비율): 무작위(같은 샨텐 중) ${EFF_AGREE.random}% · 유효패 ${EFF_AGREE.ukeire}% · EV(이 표) ${EFF_AGREE.ev}% · <b>한 수 앞 평균 유효패까지 본 효율평가 ${EFF_AGREE.twoStep}%</b>. 이 EV는 단순 유효패보다 낫다고 입증되지 않았고, 한 수 앞까지 보는 지표가 가장 잘 맞았습니다.`));
}

export function fillPushFold(slot, q, res, chosenKind) {
  slot.className = 'ev-slot';
  slot.replaceChildren();
  slot.append(el('h5', '', '⚖️ 푸시/풀 기댓값'));
  const roles = [{ kind: chosenKind, label: '내 선택' }, { kind: q.opts[0].kind, label: 'Mortal' }, { kind: q.actual, label: '실제' },
    { kind: res.bestPush.kind, label: '밀기 최선' }, { kind: res.bestFold.kind, label: '접기 최선' }];
  const tbl = el('table');
  tbl.innerHTML = `<tr><th>버림</th><th>방총률<br>(보정)</th><th>샨텐</th><th>내 기대득점<br>(${PUSH_HORIZON}순)</th><th>밀기 EV</th><th>접기 EV</th><th></th></tr>`;
  const rows = res.rows.slice().sort((a, b) => Math.max(b.evPush, b.evFold) - Math.max(a.evPush, a.evFold));
  for (const r of rows) {
    const tr = el('tr', (r.kind === chosenKind ? 'mine ' : '') + (r.kind === q.actual ? 'act' : ''));
    const t0 = el('td'); t0.append(tileK(r.kind, 't-river'));
    tr.append(t0, el('td', '', pct(r.est)), el('td', '', shLabel(r.sh)), el('td', '', pts(r.ev)),
      el('td', r.kind === res.bestPush.kind ? 'good' : '', pts(r.evPush)), el('td', r.kind === res.bestFold.kind ? 'good' : '', pts(r.evFold)), el('td', 'muted', marks(r.kind, roles)));
    tbl.append(tr);
  }
  slot.append(tbl);
  const mm = mortalMode(q);
  const ul = el('ul', 'sum');
  ul.append(el('li', '', `밀기 최선 <b>${TILE_NAME(res.bestPush.kind)}</b>: ${pts(res.bestPush.evPush)} / 접기 최선 <b>${TILE_NAME(res.bestFold.kind)}</b>: ${pts(res.bestFold.evFold)} → 모델 권장 <b>${res.recommend === 'push' ? '밀기' : '접기'}</b>.`));
  ul.append(el('li', '', `Mortal의 1순위는 <b>${mm === 'push' ? '밀기' : '접기'}</b> — ${mm === res.recommend ? '모델과 같은 방향입니다.' : '<b>모델과 다른 방향</b>입니다. 이 간단한 모델이 놓치는 요소(순위 상황·상대 대기 추정·수비 여지)를 Mortal은 반영할 수 있습니다.'}`));
  slot.append(ul);
  const loss = STATS ? `리치 상대 방총 평균 손실: 친 ${STATS.avgDealInToRiichi.dealer.toLocaleString()}점 / 자 ${STATS.avgDealInToRiichi.child.toLocaleString()}점 (로그 실측, 리치 론 ${STATS.counts.riichiRon[0] + STATS.counts.riichiRon[1]}건).` : '';
  slot.append(el('div', 'note', `<b>모델</b>: 밀기 EV = 내 기대득점 − P(방총)×평균손실, P(방총)은 이번 패의 방총률과 이후 남은 샨텐 수만큼의 추가 위험(내 손패의 중간 위험도)을 합산. 접기 EV = −P(방총)×평균손실. ${loss} 손실 배율 ${PUSH_PARAMS.lossScale}, 미래 위험 배율 ${PUSH_PARAMS.futureMult}, 내 화료 기대 순수 ${PUSH_HORIZON}는 Mortal의 접기/밀기에 맞춰 보정한 상수이며 리치자가 먼저 화료·유국될 확률은 반영하지 않습니다.`));
  if (PUSHFOLD_AGREE) slot.append(el('div', 'note', `<b>이 모델의 신뢰도</b> (방어 문제 ${PUSHFOLD_AGREE.n}개, 상수 보정에 쓰지 않은 구간): Mortal의 접기/밀기와 같은 방향 ${PUSHFOLD_AGREE.model}% — 샨텐 규칙(2샨텐 이상 접기) ${PUSHFOLD_AGREE.rule}%보다 높지만, 전부 접는 단순 기준 ${PUSHFOLD_AGREE.majority}%에는 못 미칩니다. Mortal이 밀기를 택한 ${PUSHFOLD_AGREE.pushTotal}건 중 ${PUSHFOLD_AGREE.pushHit}건만 밀기로 판정했습니다(MCC ${PUSHFOLD_AGREE.mcc}). <b>참고용 수치이며 권장을 그대로 믿지 마세요.</b>`));
}
