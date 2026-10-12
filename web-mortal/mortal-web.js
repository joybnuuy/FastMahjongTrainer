// 브라우저/Node 공용 Mortal 분석기: wasm(상태추적+인코딩) + onnxruntime-web(Q값)
// ai/analyze.py 의 analyze()와 같은 입출력:
//   analyze(events, [{seat, idx}]) -> [{seat, idx, q|null, mask|null, reach: {q, mask}|null}]
//   q = mask 비트가 켜진 행동들의 Q값(행동 인덱스 오름차순), mask = 비트마스크 문자열(10진)

import { styleQs } from './style-head.js';

const ACTIONS = 46, OBS_LEN = 1012 * 34, REACH = 37;

// 해당 좌석에게 보이지 않는 정보(타가 손패/쯔모)를 '?'로 가린다.
export function viewFor(events, seat) {
  return events.map(ev => {
    if (ev.type === 'start_kyoku') return JSON.stringify({ ...ev, tehais: ev.tehais.map((h, i) => (i === seat ? h : Array(13).fill('?'))) });
    if (ev.type === 'tsumo' && ev.actor !== seat) return JSON.stringify({ ...ev, pai: '?' });
    return JSON.stringify(ev);
  });
}

export class MortalWeb {
  // ort: onnxruntime-web 모듈, core: wasm-bindgen 모듈({Session}), session: ort.InferenceSession
  // styleHead: parseStyleHead() 결과 (선택). 세션에 phi 출력이 있고 styleHead 가 있으면 결과에 styles: {id: q[]} 를 덧붙인다.
  constructor(ort, core, session, styleHead = null) { this.ort = ort; this.core = core; this.session = session; this.styleHead = styleHead; }

  static async create({ ort, core, model, executionProviders = ['wasm'], styleHead = null }) {
    // 메모리 사용을 줄이는 옵션: 입력 크기가 고정이라 메모리 패턴 최적화/메모리 아레나(미리 크게 잡아 두는 풀)는 이득이 작고 모바일에서 부담이 된다.
    const session = await ort.InferenceSession.create(model, { executionProviders, enableCpuMemArena: false, enableMemPattern: false });
    if (styleHead && !session.outputNames.includes('phi')) throw new Error('이 엔진에는 phi 출력이 없어 스타일 헤드를 쓸 수 없습니다');
    return new MortalWeb(ort, core, session, styleHead);
  }

  // 세션의 메모리를 돌려준다 (페이지를 떠날 때/엔진을 바꿀 때). 이후에는 이 객체를 쓸 수 없다.
  async dispose() { const s = this.session; this.session = null; try { await s?.release(); } catch { /* 무시 */ } }

  // enc: Float32Array(OBS_LEN + 46) -> {q: compact Q[], mask: string}
  async #infer(enc) {
    const { ort } = this;
    const maskU8 = Uint8Array.from(enc.subarray(OBS_LEN), v => (v ? 1 : 0));
    // ort.env.wasm.proxy=true 이면 입력 버퍼가 워커로 이전(transfer)되어 원본이 비어 버린다.
    // 텐서에는 복사본을 넘기고 enc/maskU8 는 이후 계산에 그대로 쓴다.
    const feeds = {
      obs: new ort.Tensor('float32', enc.slice(0, OBS_LEN), [1, 1012, 34]),
      mask: new ort.Tensor('bool', maskU8.slice(), [1, ACTIONS]),
    };
    const res = await this.session.run(feeds);
    const out = res.q.data;
    const q = [];
    let mask = 0n;
    for (let a = 0; a < ACTIONS; a++) if (maskU8[a]) { q.push(out[a]); mask |= 1n << BigInt(a); }
    const r = { q, mask: mask.toString() };
    if (this.styleHead && res.phi) r.styles = styleQs(this.styleHead, res.phi.data, q, mask);
    return r;
  }

  async analyze(events, requests) {
    const bySeat = new Map();
    for (const r of requests) (bySeat.get(r.seat) ?? bySeat.set(r.seat, []).get(r.seat)).push(r.idx);
    const results = [];
    for (const [seat, idxs] of bySeat) {
      const lines = viewFor(events, seat);
      const want = new Set(idxs);
      const sess = new this.core.Session(seat);
      const got = new Map();
      try {
        for (let i = 0; i < lines.length; i++) {
          const can = sess.update(lines[i], want.has(i));
          if (!want.has(i)) continue;
          if (!can) { got.set(i, null); continue; }
          const enc = sess.encode(false);
          const main = await this.#infer(enc);
          let reach = null;
          if (enc[OBS_LEN + REACH]) {
            const fork = sess.fork();
            try {
              if (fork.update(JSON.stringify({ type: 'reach', actor: seat }), true)) reach = await this.#infer(fork.encode(false));
            } finally { fork.free(); }
          }
          got.set(i, { ...main, reach });
        }
      } finally { sess.free(); }
      for (const idx of idxs) {
        const g = got.get(idx);
        results.push({ seat, idx, q: g?.q ?? null, mask: g?.mask ?? null, reach: g?.reach ?? null, ...(g?.styles ? { styles: g.styles } : {}) });
      }
    }
    return results;
  }
}
