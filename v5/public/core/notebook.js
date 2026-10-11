// /api/notebook 대체: 서버의 data/notebook.json 대신 브라우저 IndexedDB에 저장한다.
// 형식은 서버와 동일: { version: 1, entries: { [id]: { id, mode, q, created, history: [{ t, grade, pick, pro }] } } }
import * as DB from './idb.js';

const KEY = 'notebook:v1';
const empty = () => ({ version: 1, entries: {} });
let mem = null;          // IndexedDB를 못 쓰는 환경(사생활 보호 모드 등)에서는 메모리에만 보관
let chain = Promise.resolve();   // 읽기-수정-쓰기가 겹치지 않도록 직렬화

async function load() {
  try { return (await DB.get(KEY)) || mem || empty(); } catch { return mem || (mem = empty()); }
}
async function save(db) {
  mem = db;
  try { await DB.set(KEY, db); } catch { /* 메모리에는 남아 있음 */ }
}
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json' } });

export function handleNotebook(url, init = {}) {
  const u = new URL(url, location.href);
  const method = (init.method || 'GET').toUpperCase();
  const run = chain.then(async () => {
    const db = await load();
    if (method === 'POST') {
      const b = JSON.parse(init.body || '{}');
      if (!b.id || !b.attempt) return json(400, { error: 'id/attempt 필요' });
      let e = db.entries[b.id];
      if (!e) {
        if (!b.q) return json(400, { error: '새 항목은 q 필요' });
        e = db.entries[b.id] = { id: b.id, mode: b.mode, q: b.q, created: Date.now(), history: [] };
      }
      e.history.push(b.attempt);
      await save(db);
      return json(200, { ok: true, n: e.history.length });
    }
    if (method === 'DELETE') {
      delete db.entries[u.searchParams.get('id')];
      await save(db);
      return json(200, { ok: true });
    }
    return json(200, db);
  });
  chain = run.catch(() => {});
  return run.catch(e => json(500, { error: String(e.message || e) }));
}

export const exportNotebook = () => chain.then(load);
export const notebookCount = async () => Object.keys((await exportNotebook()).entries).length;

// 가져오기: 같은 id는 시도 기록(history)을 시각(t) 기준으로 합친다.
export async function importNotebook(obj) {
  if (!obj || obj.version !== 1 || typeof obj.entries !== 'object' || !obj.entries) throw new Error('오답노트 형식이 아닙니다 (version 1 필요)');
  const run = chain.then(async () => {
    const db = await load();
    let added = 0, merged = 0;
    for (const [id, e] of Object.entries(obj.entries)) {
      if (!e || !e.q || !Array.isArray(e.history)) continue;
      const cur = db.entries[id];
      if (!cur) { db.entries[id] = e; added++; continue; }
      const seen = new Set(cur.history.map(h => h.t));
      for (const h of e.history) if (!seen.has(h.t)) { cur.history.push(h); seen.add(h.t); }
      cur.history.sort((a, b) => a.t - b.t);
      merged++;
    }
    await save(db);
    return { added, merged };
  });
  chain = run.catch(() => {});
  return run;
}
