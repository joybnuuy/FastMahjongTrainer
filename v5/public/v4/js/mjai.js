// Tenhou mjlog(파싱된 게임) → mjai 이벤트열 (전체 정보 버전; 시점별 마스킹은 분석기에서)
import { decodeMeld } from './mjlog.js';

const SUITS = ['m', 'p', 's'];
const HONORS = ['E', 'S', 'W', 'N', 'P', 'F', 'C'];

export function tileStr(id) {
  const k = id >> 2;
  if (k >= 27) return HONORS[k - 27];
  if (id === 16) return '5mr';
  if (id === 52) return '5pr';
  if (id === 88) return '5sr';
  return (k % 9) + 1 + SUITS[Math.floor(k / 9)];
}

// 반환: { events, at } — at[`${round}:${evIdx}`] = 해당 mjlog 이벤트가 만든 첫 mjai 이벤트 인덱스
export function toMjai(game) {
  const events = [{ type: 'start_game', names: ['p0', 'p1', 'p2', 'p3'] }];
  const at = {};
  game.rounds.forEach((round, r) => {
    const s = round.seed;
    events.push({
      type: 'start_kyoku', bakaze: ['E', 'S', 'W', 'N'][Math.min(3, Math.floor(s[0] / 4))],
      dora_marker: tileStr(s[5]), kyoku: (s[0] % 4) + 1, honba: s[1], kyotaku: s[2], oya: round.oya,
      scores: round.ten.slice(), tehais: round.hands.map(h => h.slice().sort((a, b) => a - b).map(tileStr)),
    });
    const lastDiscard = {}; // 직전 타패 (치/퐁/대명깡의 pai)
    let ended = false;
    round.events.forEach((ev, i) => {
      at[`${r}:${i}`] = events.length;
      switch (ev.t) {
        case 'draw': events.push({ type: 'tsumo', actor: ev.p, pai: tileStr(ev.tile) }); break;
        case 'discard': {
          const tsumogiri = lastDiscard.drawn?.[ev.p] === ev.tile;
          events.push({ type: 'dahai', actor: ev.p, pai: tileStr(ev.tile), tsumogiri });
          break;
        }
        case 'meld': {
          const d = decodeMeld(ev.m, ev.p);
          const cons = d.tiles.filter(t => t !== d.called && t !== d.added).map(tileStr);
          if (d.type === 'chi') events.push({ type: 'chi', actor: ev.p, target: d.from, pai: tileStr(d.called), consumed: cons });
          else if (d.type === 'pon') events.push({ type: 'pon', actor: ev.p, target: d.from, pai: tileStr(d.called), consumed: cons });
          else if (d.type === 'daiminkan') events.push({ type: 'daiminkan', actor: ev.p, target: d.from, pai: tileStr(d.called), consumed: cons });
          else if (d.type === 'kakan') events.push({ type: 'kakan', actor: ev.p, pai: tileStr(d.added), consumed: cons });
          else events.push({ type: 'ankan', actor: ev.p, consumed: d.tiles.map(tileStr) });
          break;
        }
        case 'reach':
          events.push({ type: ev.step === 1 ? 'reach' : 'reach_accepted', actor: ev.p });
          break;
        case 'dora': events.push({ type: 'dora', dora_marker: tileStr(ev.tile) }); break;
        case 'end':
          if (ev.kind === 'AGARI') events.push({ type: 'hora', actor: +ev.attrs.who, target: +ev.attrs.fromWho });
          else events.push({ type: 'ryukyoku' });
          ended = true;
          break;
      }
      // tsumogiri 판정용: 직전 쯔모 기록
      if (ev.t === 'draw') (lastDiscard.drawn ||= {})[ev.p] = ev.tile;
      else if (ev.t === 'discard' || ev.t === 'meld') (lastDiscard.drawn ||= {})[ev.p] = null;
    });
    events.push({ type: 'end_kyoku' });
  });
  events.push({ type: 'end_game' });
  return { events, at };
}
