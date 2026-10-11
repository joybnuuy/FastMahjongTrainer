// V5 데이터 제공자: 서버의 /api/game, /api/notebook 을 정적 환경에서 대신한다. (V1/V4 화면 공통)
//  - 로그 출처: (1) 천봉 직접 받기: 배포된 패보 ID 목록(data/*.json)의 대국을 사용자 브라우저가 tenhou.net 에서 직접 받는다 (기본)
//               (2) 사용자가 설정한 "데이터 저장소" URL (manifest.json + 샤드 .json.gz, 세미 오프라인용)  (3) 사용자가 가져온 로컬 파일
//  - 분석: 브라우저 안에서 Mortal(wasm 인코더 + onnxruntime-web)로 계산. 샤드에 분석(ai)이 있으면 그대로 사용.
//  - UI 코드(app.js 등)는 수정하지 않는다. fetch('/api/…') 요청만 가로채 같은 모양의 응답을 돌려준다.
//  - 문제 지점을 뽑는 모듈(mjlog/mjai/points)은 *현재 페이지*의 js/ 폴더에서 가져온다 → V1/V4 각자의 것을 그대로 사용.
import * as DB from './idb.js';
import { MortalWeb } from './mortal-web.js';
import { handleNotebook } from './notebook.js';

const LS_KEY = 'mjp-store-v1';
const ORT_BASE = new URL('../vendor/ort/', import.meta.url).href;
const CORE_JS = new URL('../vendor/core/mortal_wasm_core.js', import.meta.url).href;
const CORE_WASM = new URL('../vendor/core/mortal_wasm_core_bg.wasm', import.meta.url).href;
const MODEL_DIR = new URL('../model/', import.meta.url).href;
// 같은 URL 을 서로 다른 출처(예: localhost 와 github.io)가 요청하면, Vary: Origin 이 없는 서버(S4)의 HTTP 캐시가 이전 출처의 CORS 헤더를 재사용해 차단된다.
// 쿼리에 출처 해시를 넣어 캐시 키를 출처별로 분리한다 (S4 는 알 수 없는 쿼리를 무시한다).
const ORIGIN_KEY = (() => { let h = 0; for (const c of location.origin) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); })();
const uiModule = name => import(new URL('js/' + name, document.baseURI).href);

// ---------------- 설정 (localStorage) ----------------
export const settings = {
  get() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } },
  set(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch { return false; } },
  patch(p) { return this.set({ ...this.get(), ...p }); },
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

// ---------------- 상태 알림 ----------------
const listeners = new Set();
export const state = { tenhouGames: 0, tenhouCached: 0, engine: 'idle', engineId: null, engineMsg: '', engineProgress: null, model: null, store: null, local: 0, sync: null };
const emit = () => listeners.forEach(f => { try { f(state); } catch { /* 무시 */ } });
export const onState = f => { listeners.add(f); f(state); };

// ---------------- Mortal 엔진 (여러 개 지원) ----------------
// 엔진 = 같은 입출력 규약(obs 1012x34 + mask 46 → q 46)을 가진 ONNX 모델. 배포된 엔진 목록은 model/engines.json 이다.
//  - 설치 기록(설정 engines: {id: version}) = 그 버전의 엔진을 이 브라우저에 받아 두었다는 표시
//  - 선택(설정 engineId) = 지금 문제를 분석하는 엔진. 설정값이 목록에 없으면 목록의 default
//  - 캐시(IndexedDB 'model:<id>:<version>')는 엔진별로 따로 지울 수 있다
// 배포된 엔진 목록. 항상 서버에 재검증한다(새 엔진/새 버전이 배포되면 달라진다).
export async function fetchEngines() {
  const reg = await (await fetch(MODEL_DIR + 'engines.json', { cache: 'no-cache' })).json();
  if (reg.format !== 1 || !Array.isArray(reg.engines) || !reg.engines.length) throw new Error('엔진 목록 형식 오류');
  return reg;
}
let registryPromise = null;
export const getRegistry = ({ fresh = false } = {}) => (fresh || !registryPromise ? (registryPromise = fetchEngines().catch(e => { registryPromise = null; throw e; })) : registryPromise);
export const installedEngines = () => settings.get().engines || {};
// 선택된 엔진 id: 설정값이 목록에 있으면 그것, 아니면 기본값
export const pickEngineId = (reg, cfg = settings.get()) => (reg.engines.some(e => e.id === cfg.engineId) ? cfg.engineId : reg.default);
export const isInstalled = info => installedEngines()[info.id] === info.version;
const markInstalled = info => { const r = { ...(settings.get().removedEngines || {}) }; delete r[info.id]; settings.patch({ engines: { ...installedEngines(), [info.id]: info.version }, removedEngines: r }); };
export const wasRemoved = id => !!(settings.get().removedEngines || {})[id];
// 선택 엔진 바꾸기 (다음 분석부터 적용)
export function useEngine(id) { settings.patch({ engineId: id }); state.engine = 'idle'; state.model = null; state.engineMsg = ''; emit(); }

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

// 엔진 파일: IndexedDB 캐시 → 네트워크. 받으면 저장하고 같은 엔진의 낡은 버전 캐시는 지운다.
async function getEngineBytes(info) {
  const key = `model:${info.id}:${info.version}`;
  try { const c = await DB.get(key); if (c) return { bytes: c, from: 'cache' }; } catch { /* IndexedDB 불가 → 네트워크 */ }
  state.engineId = info.id; state.engine = 'loading'; state.engineMsg = `${info.name} 내려받는 중…`; state.engineProgress = { got: 0, total: info.bytes }; emit();
  const res = await fetch(`${MODEL_DIR}${info.file}?v=${info.version}`);
  if (!res.ok) throw new Error(`엔진 다운로드 실패: HTTP ${res.status}`);
  const bytes = await readWithProgress(res, info.bytes, (g, t) => { state.engineProgress = { got: g, total: t }; state.engineMsg = `${info.name} 내려받는 중 ${(g / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)}MB`; emit(); });
  state.engineProgress = null;
  if (bytes.length !== info.bytes) throw new Error(`엔진 파일 크기가 맞지 않습니다 (${bytes.length} != ${info.bytes})`);
  try {
    await DB.set(key, bytes);
    for (const k of await DB.keys()) if (typeof k === 'string' && k.startsWith(`model:${info.id}:`) && k !== key) await DB.del(k);
  } catch { /* 저장 실패해도 계속 */ }
  return { bytes, from: 'network' };
}

// onnxruntime-web + wasm 인코더 코어는 엔진과 무관하게 한 번만 준비한다
let runtimePromise = null;
function loadRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const ort = await import(ORT_BASE + 'ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1;   // github.io 는 COOP/COEP 헤더를 줄 수 없어 멀티스레드 불가
    ort.env.wasm.proxy = true;     // 추론을 워커로 → UI 멈춤 방지
    const core = await import(CORE_JS);
    await core.default({ module_or_path: CORE_WASM });
    return { ort, core };
  })().catch(e => { runtimePromise = null; throw e; });
  return runtimePromise;
}

// 엔진 시작(= 실제 분석 가능한 상태). id 를 생략하면 선택된 엔진.
const enginePromises = new Map();
export class EngineNotInstalled extends Error {}
export async function ensureEngine(wanted, { allowDownload = false } = {}) {
  const reg = await getRegistry();
  const id = wanted || pickEngineId(reg);
  const want = reg.engines.find(e => e.id === id);
  // 사용자가 지운 엔진을 분석 도중에 조용히 되살리지 않는다: 설치 기록이 없으면 메인 메뉴에서 받게 한다.
  // (메뉴·설정 창이 명시적으로 받을 때만 allowDownload / installEngine 을 쓴다)
  if (want && !allowDownload && !enginePromises.has(id) && !isInstalled(want)) throw new EngineNotInstalled(`엔진 "${want.name}"이(가) 설치되어 있지 않습니다. 메인 메뉴에서 받아 주세요.`);
  if (!enginePromises.has(id)) {
    enginePromises.set(id, (async () => {
      const info = reg.engines.find(e => e.id === id);
      if (!info) throw new Error('알 수 없는 엔진: ' + id);
      const t0 = performance.now();
      state.engineId = id; state.engine = 'loading'; state.engineMsg = '엔진 준비 중…'; emit();
      const { bytes, from } = await getEngineBytes(info);
      state.engineMsg = '엔진 시작 중…'; emit();
      const { ort, core } = await loadRuntime();
      const web = await MortalWeb.create({ ort, core, model: bytes });
      state.engine = 'ready'; state.engineId = id; state.model = { ...info, from, loadMs: Math.round(performance.now() - t0) };
      state.engineMsg = `${info.name} 준비됨 (${from === 'cache' ? '캐시' : '내려받음'}, ${state.model.loadMs}ms)`;
      markInstalled(info);      // 이 버전의 엔진이 이 브라우저에서 실제로 동작함을 기록
      emit();
      return web;
    })().catch(e => { enginePromises.delete(id); state.engine = 'error'; state.engineError = e.message; state.engineMsg = '엔진 오류: ' + e.message; emit(); throw e; }));
  }
  return enginePromises.get(id);
}

// 엔진을 내려받아 캐시에 두기만 한다 (시작하지 않는다 → 메모리를 쓰지 않음). 선택된 엔진이면 시작까지 해서 동작을 확인한다.
export async function installEngine(id, { start = false } = {}) {
  const reg = await getRegistry();
  const info = reg.engines.find(e => e.id === id);
  if (!info) throw new Error('알 수 없는 엔진: ' + id);
  if (start) return ensureEngine(id, { allowDownload: true });
  await getEngineBytes(info);
  state.engine = state.model ? 'ready' : 'idle'; state.engineMsg = ''; emit();
  markInstalled(info); emit();
}

// 엔진 목록에 없는 모델 캐시 정리: 단일 엔진 시절의 'model:<버전>', 목록에서 사라진 엔진, 낡은 버전의 캐시. 지운 개수를 돌려준다.
export async function pruneOrphanEngines(reg) {
  const keep = new Set(reg.engines.map(e => `model:${e.id}:${e.version}`));
  let n = 0;
  try {
    for (const k of await DB.keys()) if (typeof k === 'string' && k.startsWith('model:') && !keep.has(k)) { await DB.del(k); n++; }
  } catch { /* IndexedDB 불가 → 무시 */ }
  // 설치 기록도 목록과 맞춘다: 목록에서 사라진 엔진은 기록에서 제거 (낡은 버전 기록은 메뉴가 '업데이트'로 보여 주도록 남긴다)
  const inst = installedEngines(), kept = Object.fromEntries(Object.entries(inst).filter(([id]) => reg.engines.some(e => e.id === id)));
  if (Object.keys(kept).length !== Object.keys(inst).length) settings.patch({ engines: kept });
  return n;
}

// ---- 지우기 (오답노트는 어떤 경우에도 지우지 않는다) ----
// 엔진 하나만 삭제: 캐시와 설치 기록. 선택된 엔진이면 다음에 다시 받아야 한다.
export async function deleteEngine(id) {
  const n = await DB.delPrefix([`model:${id}:`]).catch(() => 0);
  const inst = { ...installedEngines() }; delete inst[id];
  const patch = { engines: inst, removedEngines: { ...(settings.get().removedEngines || {}), [id]: true } };
  if (settings.get().engineId === id) patch.engineId = Object.keys(inst)[0] || null;   // 지운 엔진이 선택돼 있었으면 다른 설치된 엔진으로 (없으면 선택 해제)
  settings.patch(patch);
  enginePromises.delete(id);
  if (state.engineId === id) { state.engine = 'idle'; state.model = null; state.engineMsg = ''; }
  emit();
  return n;
}
// 모든 엔진 삭제
export async function deleteAllEngines() {
  const n = await DB.delPrefix(['model:']).catch(() => 0);
  settings.patch({ engines: {}, removedEngines: Object.fromEntries((await getRegistry().catch(() => ({ engines: [] }))).engines.map(e => [e.id, true])) });
  enginePromises.clear(); state.engine = 'idle'; state.model = null; state.engineMsg = ''; emit();
  return n;
}
// 내려받은 로그 캐시(저장소 샤드 + 천봉에서 받은 패보)만 삭제
export async function clearLogCache() {
  const n = await DB.delPrefix(['shard:', 'xml:']).catch(() => 0);
  cachedFiles.clear(); shardCache.clear(); state.sync = null; state.tenhouCached = 0; emit();
  return n;
}
// 설정(저장소 주소·화면·엔진 선택·설치 기록 등)만 초기화: 캐시와 오답노트는 그대로
export function resetSettings() { try { localStorage.removeItem(LS_KEY); } catch { /* 무시 */ } emit(); }
// 엔진 + 로그 캐시 + 설정 모두 (오답노트 제외)
export async function clearEverything() { await deleteAllEngines(); await clearLogCache(); resetSettings(); }

// ---------------- 데이터 저장소 (manifest + 샤드) ----------------
let manifest = null;      // {base, version, shards:[{file,n,ids}], games}
const shardCache = new Map();
const cachedFiles = new Set();   // 현재 manifest 버전으로 IndexedDB에 있는 샤드 파일명
const local = new Map();  // id -> {id, xml}

export async function connectStore(rawBase, { save = false } = {}) {
  const base = normalizeBase(rawBase);
  const t0 = performance.now();
  // manifest 는 분 단위로 캐시 키를 바꿔 요청 (서버가 Cache-Control/Vary 를 주지 않아 오래된 응답이 남는 문제 방지)
  const res = await fetch(`${base}manifest.json?t=${Math.floor(Date.now() / 60000)}&o=${ORIGIN_KEY}`);
  if (!res.ok) throw new Error(`manifest.json 을 받지 못했습니다 (HTTP ${res.status})`);
  const m = await res.json();
  if (m.format !== 1 || !Array.isArray(m.shards)) throw new Error('지원하지 않는 manifest 형식입니다');
  manifest = { base, version: String(m.version), shards: m.shards, games: m.shards.reduce((s, x) => s + x.n, 0) };
  shardCache.clear(); cachedFiles.clear(); delete state.storeError;
  state.store = { base, games: manifest.games, shards: manifest.shards.length, version: manifest.version, ms: Math.round(performance.now() - t0) };
  if (save) settings.patch({ storeBase: base });
  emit();
  try { // 이미 캐시된 샤드를 파악한 뒤 나머지를 백그라운드에서 받는다
    const have = new Set(await DB.keys());
    for (const sh of manifest.shards) if (have.has(`shard:${manifest.version}:${sh.file}`)) cachedFiles.add(sh.file);
  } catch { /* 무시 */ }
  syncStore();
  return state.store;
}
export function disconnectStore({ forget = false } = {}) {
  manifest = null; shardCache.clear(); cachedFiles.clear(); state.store = null; state.sync = null;
  if (forget) { const s = settings.get(); delete s.storeBase; settings.set(s); }
  emit();
}

// 샤드(gz 바이트): IndexedDB 캐시 → 네트워크. 키에 manifest.version 이 들어 있어 저장소가 갱신되면 자동으로 새로 받는다.
async function fetchShardBytes(sh) {
  const m = manifest, key = `shard:${m.version}:${sh.file}`;
  try { const c = await DB.get(key); if (c) { cachedFiles.add(sh.file); return c; } } catch { /* 네트워크로 */ }
  const res = await fetch(`${m.base}${sh.file}?v=${m.version}&o=${ORIGIN_KEY}`);
  if (!res.ok) throw new Error(`샤드를 받지 못했습니다: ${sh.file} (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  try { await DB.set(key, bytes); if (m === manifest) cachedFiles.add(sh.file); } catch { /* 저장 실패해도 계속 */ }
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
// (S4 는 연결당 처리량이 낮아(≈0.25MB/s, RTT 300ms) 병렬 연결이 훨씬 빠르다.)
let syncing = null;
export function syncStore() {
  if (!manifest) return Promise.resolve();
  if (syncing) return syncing;
  const m = manifest;
  state.sync = { done: 0, total: m.shards.length, finished: false };
  emit();
  syncing = (async () => {
    try { // 이전 버전의 캐시 정리
      for (const k of await DB.keys()) if (typeof k === 'string' && k.startsWith('shard:') && !k.startsWith(`shard:${m.version}:`)) await DB.del(k);
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
    if (state.sync) state.sync.finished = true;
    emit();
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
    const id = f.name.replace(/\.gz$/i, '').replace(/\.(xml|mjlog)$/i, '');
    local.set(id, { id, xml: text });
    ok++;
  }
  state.local = local.size; emit();
  return { ok, skipped };
}

// ---------------- 대국 선택 + 분석 ----------------
const seen = new Set();
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------------- 천봉 직접 받기 ----------------
// 앱에는 패보 본문이 없고 ID 목록(data/meijin.json: 천봉명인전)만 들어 있다. 대국은 사용자의 브라우저가 tenhou.net 에서 직접 받아
// 이 브라우저의 IndexedDB 에만 캐시한다 (재요청 없음). 요청은 순차 1개, 최소 간격을 두고 보낸다 (천봉의 권장 사항).
const DATA_DIR = new URL('../data/', import.meta.url).href;
const ID_LISTS = ['meijin'];
const TENHOU_ID_RE = /^\d{10}gm-[0-9a-f]{4}-[0-9a-f]{4,5}-[0-9a-f]{8}$/;
const TENHOU_GAP_MS = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const tenhouEnabled = () => !!settings.get().tenhou;

let tenhouList = null;     // [{id, season, players:[{name,score,pro}]}]
export async function loadTenhouList() {
  if (tenhouList) return tenhouList;
  const all = [];
  for (const name of ID_LISTS) {
    const j = await (await fetch(`${DATA_DIR}${name}.json`)).json();
    if (j.format !== 1 || !Array.isArray(j.list)) throw new Error(`ID 목록 형식 오류: ${name}`);
    for (const g of j.list) all.push({ ...g, list: name });
  }
  tenhouList = all;
  try { state.tenhouCached = (await DB.keys()).filter(k => typeof k === 'string' && k.startsWith('xml:')).length; } catch { state.tenhouCached = 0; }
  state.tenhouGames = all.length; emit();
  return all;
}

let netChain = Promise.resolve(), lastNet = 0;
function throttled(fn) {
  const run = netChain.then(async () => {
    const wait = lastNet + TENHOU_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { lastNet = Date.now(); }
  });
  netChain = run.catch(() => {});
  return run;
}
const inflight = new Map();
export function fetchTenhouXml(id) {
  if (!TENHOU_ID_RE.test(id)) return Promise.reject(new Error('올바르지 않은 패보 ID: ' + id));
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    try { const c = await DB.get('xml:' + id); if (typeof c === 'string' && c.includes('<mjloggm')) return c; } catch { /* 네트워크로 */ }
    const xml = await throttled(async () => {
      const res = await fetch(`https://tenhou.net/0/log/?${id}`);
      if (!res.ok) throw new Error(`천봉에서 패보를 받지 못했습니다 (HTTP ${res.status})`);
      return res.text();
    });
    if (!xml.includes('<mjloggm')) throw new Error('천봉이 패보가 아닌 응답을 보냈습니다 (대국이 없거나 요청이 제한되었을 수 있음)');
    try { await DB.set('xml:' + id, xml); state.tenhouCached = (state.tenhouCached || 0) + 1; emit(); } catch { /* 저장 실패해도 계속 */ }
    return xml;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
let nextTenhou = null;     // 미리 받아 두는 다음 대국 id
const pickTenhouId = () => {
  for (let i = 0; i < 20; i++) { const g = pick(tenhouList); if (!seen.has(g.id)) return g.id; }
  return pick(tenhouList).id;
};


async function randomGame() {
  const T = tenhouEnabled() ? (await loadTenhouList()).length : 0;
  const L = local.size, S = manifest ? manifest.games : 0;
  if (L + S + T === 0) return null;
  const bad = new Set();          // 이번 호출에서 받기 실패한 샤드
  let lastErr = null;
  for (let tries = 0; tries < 8; tries++) {
    let rec;
    const r0 = Math.random() * (L + S + T);
    if (r0 < T) {
      const id = (nextTenhou && !seen.has(nextTenhou)) ? nextTenhou : pickTenhouId();
      nextTenhou = null;
      try { rec = { id, xml: await fetchTenhouXml(id) }; } catch (e) { lastErr = e; continue; }
      seen.add(id);
      nextTenhou = pickTenhouId(); fetchTenhouXml(nextTenhou).catch(() => { nextTenhou = null; });   // 다음 대국을 미리 받아 둔다
      return rec;
    }
    if (r0 < T + L) rec = pick([...local.values()]);
    else {
      // 캐시된 샤드가 있으면 그 안에서만 고른다(즉시 로딩). 하나도 없으면 전체에서 고르고 그 샤드만 받는다.
      const all = manifest.shards.filter(s => !bad.has(s.file));
      const pool = cachedFiles.size ? all.filter(s => cachedFiles.has(s.file)) : all;
      if (!pool.length) break;
      let r = Math.random() * pool.reduce((a, s) => a + s.n, 0), sh = pool[0];
      for (const s of pool) { if ((r -= s.n) < 0) { sh = s; break; } }
      try { rec = pick(await loadShard(sh)); } catch (e) { lastErr = e; bad.add(sh.file); cachedFiles.delete(sh.file); continue; }
    }
    if (!seen.has(rec.id) || tries >= 6) { seen.add(rec.id); return rec; }
  }
  if (lastErr) throw lastErr;
}
async function findGame(id) {
  if (local.has(id)) return local.get(id);
  if (manifest) {
    const sh = manifest.shards.find(s => s.ids && s.ids.includes(id));
    if (sh) return (await loadShard(sh)).find(g => g.id === id) || null;
  }
  if (tenhouEnabled() && TENHOU_ID_RE.test(id)) return { id, xml: await fetchTenhouXml(id) };
  return null;
}

async function analyze(xml) {
  const [{ parseMjlog }, { toMjai }, { collectPoints }] = await Promise.all([uiModule('mjlog.js'), uiModule('mjai.js'), uiModule('points.js')]);
  const game = parseMjlog(xml);
  if (game.names.length !== 4) return null;
  const web = await ensureEngine();
  const engineId = state.engineId;
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
  return { model: state.model?.name || engineId, engine: engineId, ver: 2, points };
}

export async function getGame(id) {
  const rec = id ? await findGame(id) : await randomGame();
  if (!rec) throw new Error(id ? `저장소/가져온 파일에 없는 로그입니다: ${id}` : '불러올 로그가 없습니다. ⚙ 설정에서 천봉 직접 받기를 켜거나, 데이터 저장소 주소를 입력하거나, 로그 파일(.xml)을 가져오세요.');
  const activeId = pickEngineId(await getRegistry());
  const ai = (rec.ai && rec.ai.engine === activeId) ? rec.ai : await analyze(rec.xml);   // 다른 엔진이 만든 미리 계산 분석은 쓰지 않는다
  return { id: rec.id, xml: rec.xml, ai };
}

// ---------------- /api/* 가로채기 + 자동 연결 ----------------
export function install({ gate = Promise.resolve() } = {}) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, init);
    await gate;                                   // 준비 확인이 끝나기 전에는 문제를 만들지 않는다
    if (url.startsWith('/api/notebook')) return handleNotebook(url, init);
    if (!url.startsWith('/api/game')) return realFetch(input, init);
    const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json' } });
    try {
      const id = new URL(url, location.href).searchParams.get('id');
      return json(200, await getGame(id));
    } catch (e) {
      if (e instanceof EngineNotInstalled) {          // 선택한 엔진을 지웠거나 아직 안 받은 상태 → 메인 메뉴에서 받게 한다
        const menu = new URL('../', import.meta.url);
        setTimeout(() => location.replace(new URL('?from=' + (document.documentElement.dataset.ui || 'v4'), menu).href), 1200);
        return json(502, { error: e.message + ' 잠시 후 메인 메뉴로 이동합니다…' });
      }
      return json(502, { error: String(e.message || e) });
    }
  };
  // 저장된 설정으로 자동 연결 (실패해도 앱은 계속 동작)
  const saved = settings.get().storeBase;
  if (saved) connectStore(saved).catch(e => { state.storeError = e.message; emit(); });
  window.mjpProvider = { loadTenhouList, fetchTenhouXml, tenhouEnabled, settings, state, connectStore, disconnectStore, importFiles, getGame, ensureEngine, EngineNotInstalled, installEngine, deleteEngine, deleteAllEngines, clearLogCache, resetSettings, clearEverything, syncStore, getRegistry, useEngine, pruneOrphanEngines };
}
