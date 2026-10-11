// 정적 호스팅용 데이터 제공자: 서버의 /api/game 을 대신한다.
//  - 로그 출처: (1) 사용자가 설정한 "데이터 저장소" URL (manifest.json + 샤드 .json.gz)  (2) 사용자가 가져온 로컬 파일
//  - 분석: 브라우저 안에서 Mortal(wasm 인코더 + onnxruntime-web)로 계산. 샤드에 분석 결과(ai)가 있으면 그대로 사용.
//  - app.js 는 수정하지 않는다. fetch('/api/game…') 요청만 가로채 같은 모양의 JSON({id, xml, ai})을 돌려준다.
import { parseMjlog } from './mjlog.js';
import { toMjai } from './mjai.js';
import { collectPoints } from './points.js';
import { MortalWeb } from './mortal-web.js';

const LS_KEY = 'mjp-store-v1';
const ORT_BASE = new URL('../vendor/ort/', import.meta.url).href;
const CORE_JS = new URL('../vendor/core/mortal_wasm_core.js', import.meta.url).href;
const CORE_WASM = new URL('../vendor/core/mortal_wasm_core_bg.wasm', import.meta.url).href;
const MODEL_DIR = new URL('../model/', import.meta.url).href;

// ---------------- 설정 (localStorage) ----------------
export const settings = {
  get() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } },
  set(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch { return false; } },
};

// https 만 허용 (개발 편의를 위해 localhost/127.0.0.1 은 http 도 허용). 끝에 / 보장.
export function normalizeBase(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('올바른 URL이 아닙니다'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('https:// 주소만 사용할 수 있습니다');
  u.hash = ''; u.search = '';
  let s = u.href;
  if (!s.endsWith('/')) s += '/';
  return s;
}

// ---------------- IndexedDB (모델 캐시) ----------------
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('mjp-cache', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('blobs');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('blobs').objectStore('blobs').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbSet(key, val) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function idbKeys() { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('blobs').objectStore('blobs').getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbDel(key) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').delete(key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function idbClear() { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').clear(); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

// ---------------- 상태 알림 ----------------
const listeners = new Set();
export const state = { engine: 'idle', engineMsg: '', model: null, store: null, local: 0 };
const emit = () => listeners.forEach(f => { try { f(state); } catch {} });
export const onState = f => { listeners.add(f); f(state); };

// ---------------- Mortal 엔진 (지연 로딩) ----------------
let enginePromise = null;
async function readWithProgress(res, total, onProgress) {
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress(got, total);
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
export function ensureEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const t0 = performance.now();
    state.engine = 'loading'; state.engineMsg = '모델 정보 확인 중…'; emit();
    const info = await (await fetch(MODEL_DIR + 'model.json', { cache: 'no-cache' })).json();
    let bytes = null, from = 'cache';
    try { bytes = await idbGet('model:' + info.version); } catch { /* IndexedDB 불가 → 네트워크 */ }
    if (!bytes) {
      from = 'network';
      const res = await fetch(`${MODEL_DIR}${info.file}?v=${info.version}`);
      if (!res.ok) throw new Error('모델 다운로드 실패: HTTP ' + res.status);
      bytes = await readWithProgress(res, info.bytes, (g, t) => { state.engineMsg = `모델 내려받는 중 ${(g / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)}MB`; emit(); });
      try { await idbSet('model:' + info.version, bytes); } catch { /* 저장 실패해도 계속 */ }
    }
    state.engineMsg = '엔진 시작 중…'; emit();
    const ort = await import(ORT_BASE + 'ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1;   // github.io 는 COOP/COEP 헤더를 줄 수 없어 멀티스레드 불가
    ort.env.wasm.proxy = true;     // 추론을 워커로 → UI 멈춤 방지
    const core = await import(CORE_JS);
    await core.default({ module_or_path: CORE_WASM });
    const web = await MortalWeb.create({ ort, core, model: bytes });
    state.engine = 'ready'; state.model = { ...info, from, loadMs: Math.round(performance.now() - t0) };
    state.engineMsg = `모델 준비됨 (${from === 'cache' ? '캐시' : '내려받음'}, ${state.model.loadMs}ms)`; emit();
    return web;
  })().catch(e => { enginePromise = null; state.engine = 'error'; state.engineMsg = '엔진 오류: ' + e.message; emit(); throw e; });
  return enginePromise;
}
export async function clearModelCache() { await idbClear(); cachedFiles.clear(); shardCache.clear(); enginePromise = null; state.engine = 'idle'; state.model = null; state.engineMsg = ''; emit(); }

// ---------------- 데이터 저장소 (manifest + 샤드) ----------------
let manifest = null;      // {base, version, shards:[{file,n,ids}], games}
const shardCache = new Map();
const local = new Map();  // id -> {id, xml}

export async function connectStore(rawBase, { save = false } = {}) {
  const base = normalizeBase(rawBase);
  const t0 = performance.now();
  // manifest 는 분 단위로 캐시를 우회 (서버가 Cache-Control/Vary 를 주지 않아 오래된 응답이 남는 문제 방지)
  const res = await fetch(`${base}manifest.json?t=${Math.floor(Date.now() / 60000)}`);
  if (!res.ok) throw new Error(`manifest.json 을 받지 못했습니다 (HTTP ${res.status})`);
  const m = await res.json();
  if (m.format !== 1 || !Array.isArray(m.shards)) throw new Error('지원하지 않는 manifest 형식입니다');
  manifest = { base, version: String(m.version), shards: m.shards, games: m.shards.reduce((s, x) => s + x.n, 0) };
  shardCache.clear(); cachedFiles.clear();
  state.store = { base, games: manifest.games, shards: manifest.shards.length, version: manifest.version, ms: Math.round(performance.now() - t0) };
  if (save) settings.set({ ...settings.get(), storeBase: base });
  emit();
  try { // 이미 캐시된 샤드 파악 후 나머지를 백그라운드에서 받는다
    const keys = new Set(await idbKeys());
    for (const sh of manifest.shards) if (keys.has(`shard:${manifest.version}:${sh.file}`)) cachedFiles.add(sh.file);
  } catch { /* 무시 */ }
  syncStore();
  return state.store;
}
export function disconnectStore({ forget = false } = {}) {
  manifest = null; shardCache.clear(); state.store = null;
  if (forget) { const s = settings.get(); delete s.storeBase; settings.set(s); }
  emit();
}

// 샤드(gz 바이트) 가져오기: IndexedDB 캐시 → 네트워크. 키에 manifest.version 이 들어 있어 저장소가 갱신되면 자동으로 새로 받는다.
const cachedFiles = new Set();   // 현재 manifest 버전으로 IndexedDB에 있는 샤드 파일명
async function fetchShardBytes(sh) {
  const m = manifest, key = `shard:${m.version}:${sh.file}`;
  try { const c = await idbGet(key); if (c) { cachedFiles.add(sh.file); return c; } } catch { /* IndexedDB 불가 → 네트워크 */ }
  const res = await fetch(`${m.base}${sh.file}?v=${m.version}`);
  if (!res.ok) throw new Error(`샤드를 받지 못했습니다: ${sh.file} (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  try { await idbSet(key, bytes); if (m === manifest) cachedFiles.add(sh.file); } catch { /* 저장 실패해도 계속 */ }
  return bytes;
}
async function loadShard(sh) {
  if (shardCache.has(sh.file)) return shardCache.get(sh.file);
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 gzip 해제(DecompressionStream)를 지원하지 않습니다');
  const bytes = await fetchShardBytes(sh);
  const data = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  if (!Array.isArray(data.games)) throw new Error('샤드 형식 오류: ' + sh.file);
  if (shardCache.size >= 3) shardCache.delete(shardCache.keys().next().value);
  shardCache.set(sh.file, data.games);
  return data.games;
}

// 백그라운드 동기화: 모든 샤드를 병렬(3개)로 받아 IndexedDB에 저장 → 이후 즉시 로딩/오프라인.
// (S4는 연결당 처리량이 낮아(≈0.25MB/s, RTT 300ms) 병렬 연결이 훨씬 빠르다.)
let syncing = null;
export function syncStore() {
  if (!manifest) return Promise.resolve();
  if (syncing) return syncing;
  const m = manifest;
  state.sync = { done: 0, total: m.shards.length, finished: false };
  emit();
  syncing = (async () => {
    try { // 이전 버전의 캐시 정리
      for (const k of await idbKeys()) if (typeof k === 'string' && k.startsWith('shard:') && !k.startsWith(`shard:${m.version}:`)) await idbDel(k);
    } catch { /* 무시 */ }
    const queue = [...m.shards];
    const run = async () => {
      while (queue.length && m === manifest) {
        const sh = queue.shift();
        try { await fetchShardBytes(sh); } catch (e) { state.sync.error = e.message; }
        state.sync.done++; emit();
      }
    };
    await Promise.all([run(), run(), run()]);
    state.sync.finished = true; emit();
  })().finally(() => { syncing = null; });
  return syncing;
}

// ---------------- 로컬 파일 가져오기 ----------------
export async function importFiles(files) {
  let ok = 0, skipped = 0;
  for (const f of files) {
    let text;
    try {
      if (/\.gz$/i.test(f.name)) text = await new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      else text = await f.text();
    } catch { skipped++; continue; }
    if (!text.includes('<mjloggm')) { skipped++; continue; }
    const id = f.name.replace(/\.(gz|xml|mjlog)$/gi, '').replace(/\.(xml|mjlog)$/i, '');
    local.set(id, { id, xml: text });
    ok++;
  }
  state.local = local.size; emit();
  return { ok, skipped };
}

// ---------------- 대국 선택 + 분석 ----------------
const seen = new Set();
const pick = a => a[Math.floor(Math.random() * a.length)];

async function randomGame() {
  const L = local.size, S = manifest ? manifest.games : 0;
  if (L + S === 0) return null;
  for (let tries = 0; tries < 6; tries++) {
    let rec;
    if (Math.random() * (L + S) < L) rec = pick([...local.values()]);
    else {
      // 캐시된 샤드가 있으면 그 안에서만 고른다(즉시 로딩). 하나도 없으면 전체에서 고르고 그 샤드만 받는다.
      const pool = cachedFiles.size ? manifest.shards.filter(s => cachedFiles.has(s.file)) : manifest.shards;
      let r = Math.random() * pool.reduce((a, s) => a + s.n, 0), sh = pool[0];
      for (const s of pool) { if ((r -= s.n) < 0) { sh = s; break; } }
      rec = pick(await loadShard(sh));
    }
    if (!seen.has(rec.id) || tries === 5) { seen.add(rec.id); return rec; }
  }
}
async function findGame(id) {
  if (local.has(id)) return local.get(id);
  if (!manifest) return null;
  const sh = manifest.shards.find(s => s.ids && s.ids.includes(id));
  return sh ? (await loadShard(sh)).find(g => g.id === id) : null;
}

async function analyze(xml) {
  const game = parseMjlog(xml);
  if (game.names.length !== 4) return null;
  const web = await ensureEngine();
  const { events, at } = toMjai(game);
  const pts = collectPoints(game);
  const idxOf = p => at[`${p.r}:${p.drawI}`];
  const results = await web.analyze(events, pts.map(p => ({ seat: p.seat, idx: idxOf(p) })));
  const byKey = new Map(results.map(r => [`${r.seat}:${r.idx}`, r]));
  const points = {};
  for (const p of pts) {
    const r = byKey.get(`${p.seat}:${idxOf(p)}`);
    if (r && r.q) points[p.key] = { seat: p.seat, mode: p.mode, q: r.q, mask: String(r.mask), reach: r.reach && { q: r.reach.q, mask: String(r.reach.mask) } };
  }
  return { model: 'Mortal-S42 (web, int8 weights)', points };
}

export async function getGame(id) {
  const rec = id ? await findGame(id) : await randomGame();
  if (!rec) throw new Error(id ? `저장소/가져온 파일에 없는 로그입니다: ${id}` : '불러올 로그가 없습니다. ⚙ 설정에서 데이터 저장소 주소를 입력하거나 로그 파일(.xml)을 가져오세요.');
  const ai = rec.ai ?? await analyze(rec.xml);
  return { id: rec.id, xml: rec.xml, ai };
}

// ---------------- /api/game 가로채기 ----------------
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/game')) return realFetch(input, init);
  const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json' } });
  try {
    const id = new URL(url, location.href).searchParams.get('id');
    return json(200, await getGame(id));
  } catch (e) { return json(502, { error: String(e.message || e) }); }
};

// 저장된 설정으로 자동 연결 (실패해도 앱은 계속 동작)
const saved = settings.get().storeBase;
if (saved) connectStore(saved).catch(e => { state.storeError = e.message; emit(); });

window.mjpProvider = { settings, state, connectStore, disconnectStore, importFiles, getGame, ensureEngine, clearModelCache, syncStore };
