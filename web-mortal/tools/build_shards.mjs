// cache/*.xml (천봉 4인 로그) → 데이터 저장소용 샤드(.json.gz) + manifest.json
// 사용: node web-mortal/tools/build_shards.mjs [--out web-mortal/store-out] [--per 100] [--with-ai]
//   --with-ai : cache/<id>.ai.json (서버가 계산한 Mortal 분석)이 있는 대국은 함께 넣는다 (브라우저 계산 생략)
// 주의: 결과물은 대국 로그를 담고 있다. 공개 저장소(github 등)에 올리지 말고 본인 저장소에만 올릴 것.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseMjlog } from '../../public/js/mjlog.js';

const WM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WM, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(WM, 'store-out')));
const PER = Number(arg('--per', 100));
const WITH_AI = process.argv.includes('--with-ai');
const CACHE = path.join(ROOT, 'cache');

fs.mkdirSync(OUT, { recursive: true });
const games = [];
for (const f of fs.readdirSync(CACHE).filter(f => f.endsWith('.xml')).sort()) {
  const id = f.replace(/\.xml$/, '');
  const xml = fs.readFileSync(path.join(CACHE, f), 'utf8');
  try { if (parseMjlog(xml).names.length !== 4) continue; } catch { continue; }
  const rec = { id, xml };
  const aiF = path.join(CACHE, id + '.ai.json');
  if (WITH_AI && fs.existsSync(aiF)) rec.ai = JSON.parse(fs.readFileSync(aiF, 'utf8'));
  games.push(rec);
}

const shards = [];
for (let i = 0, n = 0; i < games.length; i += PER, n++) {
  const part = games.slice(i, i + PER);
  const file = `shard-${String(n).padStart(3, '0')}.json.gz`;
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ games: part })), { level: 9 });
  fs.writeFileSync(path.join(OUT, file), gz);
  shards.push({ file, n: part.length, bytes: gz.length, ids: part.map(g => g.id) });
}
const version = Date.now().toString(36);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ format: 1, version, created: new Date().toISOString(), shards }));
const total = shards.reduce((s, x) => s + x.bytes, 0);
console.log(`게임 ${games.length}판 → 샤드 ${shards.length}개 (${(total / 1e6).toFixed(1)}MB), manifest version=${version}`);
console.log('출력:', OUT);
