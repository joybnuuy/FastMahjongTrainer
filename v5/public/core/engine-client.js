// 메인 스레드 쪽 엔진 핸들: engine-worker.js 에 요청을 보내고 결과를 받는다. dispose() 는 워커를 종료해 메모리를 즉시 돌려준다.
export class RemoteMortal {
  #worker; #pending = new Map(); #seq = 0; #dead = false;
  constructor(worker) {
    this.#worker = worker;
    worker.onmessage = ({ data }) => { const p = this.#pending.get(data.id); if (!p) return; this.#pending.delete(data.id); data.ok ? p.res(data.result) : p.rej(new Error(data.error)); };
    worker.onerror = e => { const err = new Error(e.message || '엔진 워커 오류'); for (const p of this.#pending.values()) p.rej(err); this.#pending.clear(); };
  }
  static async create({ model, ortUrl, ortBase, coreJs, coreWasm, style = null }) {
    const worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
    const web = new RemoteMortal(worker);
    try { await web.#call('init', { model, ortUrl, ortBase, coreJs, coreWasm, style }, [model.buffer, ...(style ? [style.bin.buffer] : [])]); }
    catch (e) { web.dispose(); throw e; }
    return web;
  }
  #call(type, payload, transfer = []) {
    if (this.#dead) return Promise.reject(new Error('엔진이 종료되었습니다'));
    const id = ++this.#seq;
    return new Promise((res, rej) => { this.#pending.set(id, { res, rej }); this.#worker.postMessage({ id, type, ...payload }, transfer); });
  }
  stats() { return this.#call('stats', {}); }   // 워커 안 wasm 메모리 크기(바이트) 목록 (진단용)
  analyze(events, requests) { return this.#call('analyze', { events, requests }); }
  async dispose() {
    this.#dead = true; this.#worker.terminate();
    const err = new Error('엔진이 종료되었습니다'); for (const p of this.#pending.values()) p.rej(err); this.#pending.clear();
  }
}
