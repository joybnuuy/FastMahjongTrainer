// Tenhou mjlog(XML) 파서 + 국 단위 상태 시뮬레이터
export const kindOf = id => id >> 2;
export const isRed = id => id === 16 || id === 52 || id === 88;

export function parseMjlog(xml) {
  const game = { names: [], dan: [], rounds: [] };
  const tagRe = /<([A-Za-z0-9]+)((?:\s+[A-Za-z0-9_]+="[^"]*")*)\s*\/?>/g;
  let cur = null, m;
  while ((m = tagRe.exec(xml))) {
    const name = m[1], attrs = {};
    for (const a of m[2].matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const nums = s => (s === '' || s === undefined ? [] : s.split(',').map(Number));
    if (name === 'UN' && attrs.n0 !== undefined && attrs.n3 !== undefined) {
      game.names = [0, 1, 2, 3].map(i => { try { return decodeURIComponent(attrs['n' + i]); } catch { return attrs['n' + i]; } });
      game.dan = (attrs.dan || '').split(',').map(Number);
    } else if (name === 'INIT') {
      cur = {
        seed: nums(attrs.seed), ten: nums(attrs.ten).map(x => x * 100), oya: +attrs.oya,
        hands: [0, 1, 2, 3].map(i => nums(attrs['hai' + i])), events: [], result: null,
      };
      game.rounds.push(cur);
    } else if (!cur) {
      continue;
    } else if (/^[TUVW]\d+$/.test(name)) {
      cur.events.push({ t: 'draw', p: 'TUVW'.indexOf(name[0]), tile: +name.slice(1) });
    } else if (/^[DEFGdefg]\d+$/.test(name)) {
      cur.events.push({ t: 'discard', p: 'DEFGdefg'.indexOf(name[0]) % 4, tile: +name.slice(1) });
    } else if (name === 'N') {
      cur.events.push({ t: 'meld', p: +attrs.who, m: +attrs.m });
    } else if (name === 'REACH') {
      cur.events.push({ t: 'reach', p: +attrs.who, step: +attrs.step });
    } else if (name === 'DORA') {
      cur.events.push({ t: 'dora', tile: +attrs.hai });
    } else if (name === 'AGARI' || name === 'RYUUKYOKU') {
      cur.result = { kind: name, attrs };
      cur.events.push({ t: 'end', kind: name, attrs });
    }
  }
  return game;
}

export function decodeMeld(m, who) {
  const kui = m & 3;
  if (m & 4) { // 치
    let t = m >> 10; const r = t % 3; t = Math.floor(t / 3);
    t = (Math.floor(t / 7) * 9 + (t % 7)) * 4;
    const h = [(m >> 3) & 3, (m >> 5) & 3, (m >> 7) & 3];
    const tiles = [t + h[0], t + 4 + h[1], t + 8 + h[2]];
    return { type: 'chi', tiles, called: tiles[r], from: (who + kui) % 4 };
  }
  if (m & 8) { // 퐁
    let t = m >> 9; const r = t % 3; t = Math.floor(t / 3) * 4;
    const unused = (m >> 5) & 3;
    const tiles = [0, 1, 2, 3].filter(i => i !== unused).map(i => t + i);
    return { type: 'pon', tiles, called: tiles[r], from: (who + kui) % 4 };
  }
  if (m & 16) { // 가칸
    let t = m >> 9; t = Math.floor(t / 3) * 4;
    const added = t + ((m >> 5) & 3);
    return { type: 'kakan', tiles: [t, t + 1, t + 2, t + 3], added };
  }
  const hai0 = m >> 8, t = (hai0 >> 2) * 4;
  const tiles = [t, t + 1, t + 2, t + 3];
  if (kui === 0) return { type: 'ankan', tiles };
  return { type: 'daiminkan', tiles, called: hai0, from: (who + kui) % 4 };
}

function removeId(arr, id) {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
}

export function newState(round) {
  return {
    round,
    kyoku: round.seed[0], honba: round.seed[1], kyotaku: round.seed[2],
    oya: round.oya,
    dora: [round.seed[5]],
    scores: round.ten.slice(),
    hands: round.hands.map(h => h.slice()),
    melds: [[], [], [], []],
    rivers: [[], [], [], []],
    drawn: [null, null, null, null],
    pending: [false, false, false, false],
    reachSeq: [0, 0, 0, 0],
    riichi: [null, null, null, null], // {seq} 성립한 리치
    discards: [], // 전체 타패 로그 {p, tile, seq}
    seq: 0, wall: 70, draws: 0,
  };
}

export function applyEvent(st, ev) {
  const p = ev.p;
  switch (ev.t) {
    case 'draw':
      st.hands[p].push(ev.tile); st.drawn[p] = ev.tile; st.wall--; st.draws++;
      break;
    case 'discard': {
      removeId(st.hands[p], ev.tile);
      const entry = { tile: ev.tile, tsumogiri: ev.tile === st.drawn[p], riichi: st.pending[p], called: false, seq: st.seq };
      st.rivers[p].push(entry);
      st.discards.push({ p, tile: ev.tile, seq: st.seq });
      if (st.pending[p]) st.reachSeq[p] = st.seq;
      st.drawn[p] = null;
      break;
    }
    case 'meld': {
      const d = decodeMeld(ev.m, p);
      if (d.type === 'chi' || d.type === 'pon' || d.type === 'daiminkan') {
        for (const t of d.tiles) if (t !== d.called) removeId(st.hands[p], t);
        const r = st.rivers[d.from];
        for (let i = r.length - 1; i >= 0; i--) if (r[i].tile === d.called) { r[i].called = true; break; }
        st.melds[p].push(d);
      } else if (d.type === 'ankan') {
        for (const t of d.tiles) removeId(st.hands[p], t);
        st.melds[p].push(d);
      } else { // kakan
        removeId(st.hands[p], d.added);
        const idx = st.melds[p].findIndex(x => x.type === 'pon' && x.tiles[0] >> 2 === d.added >> 2);
        const old = idx >= 0 ? st.melds[p][idx] : null;
        const nm = { type: 'kakan', tiles: d.tiles, called: old?.called, from: old?.from };
        if (idx >= 0) st.melds[p][idx] = nm; else st.melds[p].push(nm);
      }
      st.drawn[p] = null;
      break;
    }
    case 'reach':
      if (ev.step === 1) st.pending[p] = true;
      else { st.pending[p] = false; st.riichi[p] = { seq: st.reachSeq[p] }; st.scores[p] -= 1000; }
      break;
    case 'dora':
      st.dora.push(ev.tile);
      break;
  }
}

// hook.before(st, ev, i) / hook.after(st, ev, i)  — st.seq는 이벤트 처리 직전에 증가
export function replayRound(round, hook = {}) {
  const st = newState(round);
  for (let i = 0; i < round.events.length; i++) {
    const ev = round.events[i];
    st.seq++;
    if (hook.before && hook.before(st, ev, i) === false) return;
    applyEvent(st, ev);
    if (hook.after && hook.after(st, ev, i) === false) return;
  }
}

// 도라 표시패 → 도라 종류
export function doraKind(ind) {
  const k = ind >> 2;
  if (k < 27) return k % 9 === 8 ? k - 8 : k + 1;
  if (k < 31) return k === 30 ? 27 : k + 1;
  return k === 33 ? 31 : k + 1;
}

// 내 시점에서 이미 보이는 패 매수 (손패 + 전원 후로 + 안 울린 강 + 도라표시)
export function visibleCounts(st, me) {
  const v = new Array(34).fill(0);
  for (const id of st.hands[me]) v[id >> 2]++;
  for (let p = 0; p < 4; p++) {
    for (const m of st.melds[p]) for (const t of m.tiles) v[t >> 2]++;
    for (const e of st.rivers[p]) if (!e.called) v[e.tile >> 2]++;
  }
  for (const d of st.dora) v[d >> 2]++;
  return v;
}
