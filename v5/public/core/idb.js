// IndexedDB 작은 래퍼: DB 'mjp-cache' / 스토어 'blobs' (이전 버전과 같은 이름 → 기존 캐시 재사용)
// 키 규칙: 'model:<버전>', 'shard:<manifest버전>:<파일>', 'notebook:v1'
const DB_NAME = 'mjp-cache', STORE = 'blobs';

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

export const get = key => tx('readonly', s => s.get(key));
export const set = (key, val) => tx('readwrite', s => s.put(val, key));
export const del = key => tx('readwrite', s => s.delete(key));
export const keys = () => tx('readonly', s => s.getAllKeys());

// 접두사로 시작하는 키만 삭제 (예: 모델/로그 캐시만 지우고 오답노트는 보존)
export async function delPrefix(prefixes) {
  const all = await keys();
  const targets = all.filter(k => typeof k === 'string' && prefixes.some(p => k.startsWith(p)));
  for (const k of targets) await del(k);
  return targets.length;
}
