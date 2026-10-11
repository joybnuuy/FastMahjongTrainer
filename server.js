// 의존성 없는 로컬 서버: 정적 파일 + Tenhou 로그 프록시/캐시
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseMjlog } from './public/js/mjlog.js';
import { toMjai } from './public/js/mjai.js';
import { collectPoints } from './public/js/points.js';
import { MortalWorker, aiInstalled } from './ai/client.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, 'cache');
const PORT = Number(process.env.PORT) || 3000;
const UA = { 'User-Agent': 'Mozilla/5.0 FastMahjongPractice' };
fs.mkdirSync(CACHE, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

async function get(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// --- 최근 로그 인덱스 (시간별 scc 파일 → 4인 봉황방 로그 ID) ---
let fileList = { at: 0, files: [] };
const idsByFile = new Map();

async function recentFiles() {
  if (Date.now() - fileList.at < 30 * 60e3 && fileList.files.length) return fileList.files;
  const txt = (await get('https://tenhou.net/sc/raw/list.cgi')).toString();
  const files = [...txt.matchAll(/file:'(scc\d{10}\.html\.gz)'/g)].map(m => m[1]);
  fileList = { at: Date.now(), files };
  return files;
}

async function idsOf(file) {
  if (idsByFile.has(file)) return idsByFile.get(file);
  const html = zlib.gunzipSync(await get(`https://tenhou.net/sc/raw/dat/${file}`)).toString();
  const ids = [];
  for (const line of html.split('\n')) {
    if (!line.includes('四鳳')) continue; // 4인 마작 봉황방만
    const m = line.match(/log=([0-9a-z-]+)/);
    if (m) ids.push(m[1]);
  }
  idsByFile.set(file, ids);
  return ids;
}

async function randomId() {
  const files = (await recentFiles()).slice(-96, -3); // 최근 ~4일, 가장 최근 몇 시간 제외
  for (let tries = 0; tries < 8; tries++) {
    const ids = await idsOf(files[Math.floor(Math.random() * files.length)]);
    if (ids.length) return ids[Math.floor(Math.random() * ids.length)];
  }
  throw new Error('로그 ID를 찾지 못했습니다');
}

async function loadLog(id) {
  if (!/^[0-9a-z-]{10,60}$/i.test(id)) throw new Error('bad id');
  const f = path.join(CACHE, id + '.xml');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const xml = (await get(`https://tenhou.net/0/log/?${id}`)).toString();
  if (!xml.startsWith('<mjloggm')) throw new Error('로그 형식이 아닙니다 (만료된 로그일 수 있음)');
  fs.writeFileSync(f, xml);
  return xml;
}

// --- Mortal 분석 (선택된 판단 지점만, 결과는 캐시) ---
const worker = aiInstalled() ? new MortalWorker() : null;
if (!worker) console.log('Mortal 미설치: 효율 엔진으로 동작합니다 (ai/ 설치 필요)');
async function analyzeAi(id, xml) {
  if (!worker) return null;
  const f = path.join(CACHE, id + '.ai.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  try {
    const game = parseMjlog(xml);
    if (game.names.length !== 4) return null;
    const { events, at } = toMjai(game);
    const pts = collectPoints(game);
    const idxOf = p => at[`${p.r}:${p.drawI}`];
    const results = await worker.analyze(events, pts.map(p => ({ seat: p.seat, idx: idxOf(p) })));
    const byKey = new Map(results.map(r => [`${r.seat}:${r.idx}`, r]));
    const points = {};
    pts.forEach(p => { const r = byKey.get(`${p.seat}:${idxOf(p)}`); if (r && r.q) points[p.key] = { seat: p.seat, mode: p.mode, type: r.type, q: r.q, mask: String(r.mask), reach: r.reach && { q: r.reach.q, mask: String(r.reach.mask) } }; });
    const ai = { model: 'Mortal-S42', points };
    fs.writeFileSync(f, JSON.stringify(ai));
    return ai;
  } catch (e) { console.error('AI 분석 실패', id, e.message); return null; }
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/game') {
      const id = url.searchParams.get('id') || (await randomId());
      const xml = await loadLog(id);
      return json(res, 200, { id, xml, ai: await analyzeAi(id, xml) });
    }
    let p = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!p.startsWith(PUB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    json(res, 502, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
