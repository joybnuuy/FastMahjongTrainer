// v5/dist 를 GitHub Pages 저장소의 하위 폴더로 복사한다 (커밋/푸시는 하지 않는다).
// 사용: node web-mortal/tools/stage_pages.mjs [--dest <저장소 경로>] [--subdir mahjong] [--clean]
//   --dest   기본: web-mortal/deploy  (joybnuuy.github.io 를 로컬에 클론했다면 그 경로를 지정)
//   --subdir 기본: mahjong            → 결과 주소: https://<사용자>.github.io/<subdir>/
//   --clean  복사 전에 <dest>/<subdir> 만 비운다 (그 밖의 파일은 절대 건드리지 않음)
// 복사 전에 안전 점검: 로그 데이터, 개인 식별 정보, S4 주소/계정 ID 가 v5/dist 안에 섞여 있으면 중단한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { personalPattern } from './guard.mjs';

const WM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(WM, '..', 'v5', 'dist');   // node v5/tools/build.mjs 의 산출물
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const DEST = path.resolve(arg('--dest', path.join(WM, 'deploy')));
const SUB = String(arg('--subdir', 'mahjong')).replace(/^\/+|\/+$/g, '');
const CLEAN = process.argv.includes('--clean');
if (!SUB || SUB.includes('..') || SUB.includes('\\')) throw new Error('--subdir 가 올바르지 않습니다');
const TARGET = path.join(DEST, SUB);

const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; };
if (!fs.existsSync(APP)) { console.error('v5/dist 가 없습니다. 먼저 node v5/tools/build.mjs 를 실행하세요.'); process.exit(1); }
const files = walk(APP);

// ---- 안전 점검 ----
const problems = [];
const TEXT = /\.(html|css|js|mjs|json|md|txt)$/i;
const FORBIDDEN = [
  [/megas4\.com/i, 'S4 주소'], [/[a-z0-9]{36}\/test1/i, 'S4 계정 ID 형태'],
  ...(personalPattern() ? [[personalPattern(), '개인 식별 정보(시스템 사용자명/git 이메일/MJP_EXTRA_FORBIDDEN)']] : []),
  [/<mjloggm\s+ver=/i, '대국 로그(XML)'], [/tenhou\.net\/0\/\?log=[0-9a-z-]{20,}/i, '특정 대국 로그 링크'],
];
for (const f of files) {
  const rel = path.relative(APP, f).replace(/\\/g, '/');
  if (/\.(xml|mjlog|gz)$/i.test(rel) || /\.ai\.json$/i.test(rel)) problems.push(`${rel}: 데이터 파일이 섞여 있음`);
  if (!TEXT.test(rel)) continue;
  const t = fs.readFileSync(f, 'utf8');
  for (const [re, what] of FORBIDDEN) if (re.test(t)) problems.push(`${rel}: ${what} 발견`);
}
const sizeOf = f => fs.statSync(f).size;
const big = files.filter(f => sizeOf(f) > 90e6);
for (const f of big) problems.push(`${path.relative(APP, f)}: 90MB 초과 (GitHub 파일 한도 100MB)`);
if (problems.length) { console.error('중단 — 공개하면 안 되는 내용이 있습니다:\n  ' + problems.join('\n  ')); process.exit(1); }

// ---- 복사 ----
if (CLEAN && fs.existsSync(TARGET)) {
  if (!path.resolve(TARGET).startsWith(path.resolve(DEST) + path.sep)) throw new Error('비정상 경로');
  fs.rmSync(TARGET, { recursive: true, force: true });
}
for (const f of files) {
  const out = path.join(TARGET, path.relative(APP, f));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(f, out);
}
const total = files.reduce((s, f) => s + sizeOf(f), 0);
console.log(`복사 완료: ${files.length}개 파일, ${(total / 1e6).toFixed(1)}MB → ${TARGET}`);
console.log(`공개 주소(예상): https://<사용자>.github.io/${SUB}/`);
const top = files.sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, 4).map(f => `${path.relative(APP, f).replace(/\\/g, '/')} ${(sizeOf(f) / 1e6).toFixed(1)}MB`);
console.log('큰 파일:', top.join(' · '));
console.log(fs.existsSync(path.join(DEST, '.git')) ? 'git 저장소 확인됨 — 변경 내용을 검토한 뒤 직접 커밋/푸시하세요.' : '(참고) 이 경로에는 .git 이 없습니다. 저장소 폴더로 복사해 가서 커밋하세요.');
