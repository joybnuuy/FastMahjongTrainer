// AI에게 물어볼 판단 지점 선택 (서버에서 사용). key = `${round}:${discardEventIdx}`
import { replayRound } from './mjlog.js';
import { riichiInfo } from './danger.js';

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 반환: [{ key, r, i, drawI, seat, mode: 'eff'|'def' }]
export function collectPoints(game, { effMax = 12, defMax = 10, effPerRound = 3 } = {}) {
  const eff = [], def = [];
  game.rounds.forEach((round, r) => {
    const lastDraw = [-1, -1, -1, -1];
    const effR = [];
    replayRound(round, {
      before(st, ev, i) {
        if (ev.t === 'draw') { lastDraw[ev.p] = i; return; }
        if (ev.t !== 'discard' || st.drawn[ev.p] == null || st.riichi[ev.p] || st.pending[ev.p]) return;
        if (lastDraw[ev.p] < 0) return;
        const base = { key: `${r}:${i}`, r, i, drawI: lastDraw[ev.p], seat: ev.p };
        const anyRiichi = st.riichi.some(Boolean);
        const turn = st.rivers[ev.p].length;
        if (!anyRiichi) {
          if (turn >= 1 && turn <= 14) effR.push({ ...base, mode: 'eff' });
        } else if (st.melds[ev.p].length < 3) {
          const kinds = new Set(st.hands[ev.p].map(t => t >> 2));
          const hit = [0, 1, 2, 3].some(rp => rp !== ev.p && st.riichi[rp] && [...riichiInfo(st, rp).ron].some(k => kinds.has(k)));
          if (hit) def.push({ ...base, mode: 'def' });
        }
      },
    });
    eff.push(...shuffle(effR).slice(0, effPerRound));
  });
  return [...shuffle(eff).slice(0, effMax), ...shuffle(def).slice(0, defMax)];
}
