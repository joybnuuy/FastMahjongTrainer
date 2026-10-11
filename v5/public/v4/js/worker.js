import { generate } from './gen.js';
import { evaluateDiscards } from './ev.js';
import { pushFold } from './pushfold.js';
import { evalDiscards, countsOf } from './engine.js';
import { doraKind } from './mjlog.js';

const isRed = id => id === 16 || id === 52 || id === 88;

// 해설용 무거운 계산 (화료확률·기대타점 DP, 푸시/풀 EV)
function runJob(job) {
  const q = job.q, v = q.view, me = v.me;
  if (job.job === 'eff') {
    const rows = evaluateDiscards(q.hand, {
      melds: v.melds[me], dora: v.dora, unseen: q.unseen, roundWind: 27 + (v.kyoku >= 4 ? 1 : 0),
      seatWind: 27 + ((me - v.oya + 4) % 4), dealer: me === v.oya, wall: v.wall,
    }, { include: job.include, max: 5 });
    // 한 수 앞 효율 평가(V1 지표: 유효패 + 잠재력 + 도라)
    const dk = new Set(v.dora.map(doraKind)), reds = new Set(q.hand.filter(isRed).map(t => t >> 2));
    const local = evalDiscards(countsOf(q.hand), v.melds[me].length, q.unseen.slice(), dk, reds)
      .map(o => ({ kind: o.kind, sh: o.shanten, ue: o.ue, next: o.next ?? null, rank: o.rank, deep: !!o.deep }));
    return { rows, local };
  }
  return pushFold(q, job.include);
}

self.onmessage = e => {
  const d = e.data;
  try {
    if (d.job) return self.postMessage({ tag: d.tag, result: runJob(d) });
    self.postMessage({ id: d.id, tag: d.tag, out: generate(d.xml, d.id, d.ai) });
  } catch (err) {
    self.postMessage({ id: d.id, tag: d.tag, error: String(err && err.stack || err) });
  }
};
