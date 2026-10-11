// 천봉명인전 대회 페이지(tenhou.net/cs/<연도>/<월>tm/)에서 패보 ID 목록을 뽑아 JSON 으로 만든다.
// 패보 본문은 받지 않는다 (ID 와 대국자 이름·점수만). 앱은 이 ID 로 사용자 브라우저에서 천봉에 직접 요청한다.
// 사용: node web-mortal/tools/collect_meijin.mjs [--out v5/public/data/meijin.json] [--refresh] [--gap 3000]
//   페이지 HTML 은 web-mortal/ids-cache/ 에 저장해 두고 다시 요청하지 않는다 (--refresh 로 강제). 요청은 순차, 간격 --gap ms.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WM, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg('--out', path.join('v5', 'public', 'data', 'meijin.json')));
const GAP = Number(arg('--gap', 3000));
const REFRESH = process.argv.includes('--refresh');
const CACHE = path.join(WM, 'ids-cache');

// 기수 → 페이지 (가이드 문서 표 기준; 13기는 진행 중이라 다시 실행하면 늘어난다)
const SEASONS = [
  [1, '2011/06tm'], [2, '2012/06tm'], [3, '2013/06tm'], [4, '2014/06tm'], [5, '2015/06tm'], [6, '2016/07tm'], [7, '2017/07tm'],
  [8, '2018/08tm'], [9, '2019/08tm'], [10, '2020/09tm'], [11, '2021/10tm'], [12, '2025/04tm'], [13, '2026/09tm'],
];
const ID_RE = /^\d{10}gm-[0-9a-f]{4}-[0-9a-f]{4,5}-[0-9a-f]{8}$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(slug) {
  const f = path.join(CACHE, slug.replace('/', '_') + '.html');
  if (!REFRESH && fs.existsSync(f) && fs.statSync(f).size > 1000) return fs.readFileSync(f, 'utf8');
  fs.mkdirSync(CACHE, { recursive: true });
  const r = await fetch(`https://tenhou.net/cs/${slug}/`);
  if (!r.ok) throw new Error(`${slug}: HTTP ${r.status}`);
  const html = await r.text();
  fs.writeFileSync(f, html);
  await sleep(GAP);
  return html;
}

// "Ⓟ堀慎吾(+64.8) yoteru(+32.7) …" → [{name, score, pro}]. 점수가 없는 대국자도 허용한다 (공백으로 나눈 4토큰).
function players(text) {
  return text.split(/\s+/).filter(Boolean).map(tok => {
    const m = tok.match(/^(.*)\(([+-]?\d+(?:\.\d+)?)\)$/);
    const name = m ? m[1] : tok, score = m ? Number(m[2]) : undefined;
    return { name: name.replace(/^[ⓅⓈ]/, ''), ...(score !== undefined ? { score } : {}), ...(name.startsWith('Ⓟ') ? { pro: true } : {}), ...(name.startsWith('Ⓢ') ? { writer: true } : {}) };
  });
}

const games = [], seen = new Set(), report = [];
for (const [season, slug] of SEASONS) {
  const html = await page(slug);
  let n = 0, noScore = 0;
  // 마크업이 기마다 조금씩 달라서(</a> 누락, <br>, <font>※ 등) 링크 뒤부터 다음 링크/행 끝까지를 잘라 태그를 걷어낸다
  const re = /\?log=([^"&'>\s]+)/g;
  const marks = [...html.matchAll(re)].map(x => ({ id: x[1], at: x.index + x[0].length }));
  for (let i = 0; i < marks.length; i++) {
    const id = marks[i].id;
    if (!ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    let seg = html.slice(marks[i].at, marks[i + 1] ? marks[i + 1].at : marks[i].at + 600);
    const end = seg.indexOf('</tr>'); if (end >= 0) seg = seg.slice(0, end);
    const text = seg.replace(/<[^>]*>/g, ' ').replace(/^[^>]*>/, '').replace(/牌譜|※|\/td>/g, ' ').replace(/&[a-z]+;/g, ' ').trim();
    const ps = players(text);
    if (ps.length !== 4) { console.warn(`  경고: ${slug} ${id} 대국자 ${ps.length}명 — 건너뜀`); continue; }
    if (ps.some(p => p.score === undefined)) noScore++;
    games.push({ id, season, players: ps });
    n++;
  }
  report.push(`${String(season).padStart(2)}기 ${slug.padEnd(10)} ${String(n).padStart(4)}판${noScore ? `  (점수 없음 ${noScore})` : ''}`);
}
console.log(report.join('\n'));

const meta = { format: 1, source: 'tenhou-meijin', note: '천봉명인전 공식 대회 페이지에서 뽑은 패보 ID 목록 (패보 본문 미포함). 규칙: 4인 동남 쿠이탕 아카3, 30000점 시작/반환, 우마 +50/+20/0/-70(1기 제외).', games: games.length, generated: new Date().toISOString().slice(0, 10) };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ ...meta, list: games }) + '\n');
console.log(`\n총 ${games.length}판 → ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e3).toFixed(0)}KB)`);
