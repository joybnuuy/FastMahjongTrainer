// 개발용 정적 서버: 앱(기본 v5/dist)과 데이터 저장소 시뮬레이션(store-out/, CORS 허용)을 각각 띄운다.
// 사용: node web-mortal/tools/serve.mjs   → 앱 http://127.0.0.1:8770/  ·  저장소 http://127.0.0.1:8771/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.md': 'text/markdown; charset=utf-8', '.gz': 'application/gzip', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

const HOST = process.env.HOST || '127.0.0.1'; // 아이폰 등 LAN 기기에서 접속하려면 HOST=0.0.0.0
// 예: PREFIX=mahjong  → 앱을 /mahjong/ 아래에서만 서빙 (접두사 밖 경로는 404 → 절대경로 버그를 잡아낸다)
// Git Bash 는 "/mahjong" 을 Windows 경로로 바꿔 넘기므로 슬래시 없이 쓰는 것을 권장한다.
const PREFIX = process.env.PREFIX ? '/' + process.env.PREFIX.replace(/^\/+|\/+$/g, '') : '';
function serve(root, port, cors, prefix = '') {
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(u.pathname);
    if (prefix) { if (rel !== prefix && !rel.startsWith(prefix + '/')) { res.writeHead(404); return res.end('not found (prefix ' + prefix + ')'); } rel = rel.slice(prefix.length) || '/'; }
    if (rel.endsWith('/')) rel += 'index.html';   // GitHub Pages 처럼 디렉터리 주소는 index.html 로
    let p = path.normalize(path.join(root, rel));
    const headers = { 'Cache-Control': 'no-cache', ...(cors ? { 'Access-Control-Allow-Origin': req.headers.origin || '*' } : {}) };
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, headers); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Content-Length': fs.statSync(p).size, ...headers });
    fs.createReadStream(p).pipe(res);
  }).listen(port, HOST, () => console.log(`${cors ? '저장소' : '앱   '} http://${HOST}:${port}/  ←  ${root}`));
}
const APP_DIR = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(WM, '..', 'v5', 'dist'); // 기본: V5 배포물
serve(APP_DIR, Number(process.env.APP_PORT) || 8770, false, PREFIX);
serve(path.join(WM, 'store-out'), Number(process.env.STORE_PORT) || 8771, true);
