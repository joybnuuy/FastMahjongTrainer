// 공개용 소스 저장소(FastMahjongTrainer)로 허용 목록 파일만 복사한다 (커밋/푸시는 하지 않는다).
// 사용: node web-mortal/tools/export_source.mjs --dest <저장소 경로> [--dry]
//   --dry  복사하지 않고 대상 파일 목록과 점검 결과만 출력
// 허용 목록 밖의 파일(로그 캐시, 데이터, 모델, 빌드 산출물, 개발용 테스트, v2~v4, 외부 클론 등)은 절대 복사하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { personalPattern } from './guard.mjs';

const WM =path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WM, '..');
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const DEST = arg('--dest') && path.resolve(arg('--dest'));
const DRY = process.argv.includes('--dry');
if (!DEST) { console.error('사용법: node export_source.mjs --dest <저장소 경로> [--dry]'); process.exit(2); }

const SKIP_DIR = new Set(['node_modules', 'target', '__pycache__', 'out', 'pkg', 'store-out', 'deploy', 's4-test', 'templates', '.venv', '.git']);
const walk = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) out.push(...walk(path.posix.join(rel.replace(/\\/g, '/'), e.name))); }
    else out.push(path.posix.join(rel.replace(/\\/g, '/'), e.name));
  }
  return out;
};
const top = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f) && fs.statSync(path.join(ROOT, dir, f)).isFile()).map(f => `${dir}/${f}`);

const files = [
  'server.js', 'package.json',
  ...walk('public'), ...walk('test'),
  'ai/analyze.py', 'ai/client.js',
  ...top('web-mortal', /\.(py|js|mjs)$/), 'web-mortal/RESEARCH.md', 'web-mortal/package.json', 'web-mortal/package-lock.json',
  ...walk('web-mortal/tools'),
  'web-mortal/app/index.html', 'web-mortal/app/app.css', 'web-mortal/app/js/provider.js', 'web-mortal/app/js/settings-ui.js',
  'web-mortal/wasm-core/Cargo.toml', 'web-mortal/wasm-core/Cargo.lock', 'web-mortal/wasm-core/LICENSE', ...walk('web-mortal/wasm-core/src'),
].filter(f => fs.existsSync(path.join(ROOT, f)));
const uniq = [...new Set(files)];

// 생성/변환해서 넣는 문서들
const T = path.join(WM, 'tools', 'templates');
const generated = [
  [path.join(T, 'README.md'), 'README.md'], [path.join(T, 'NOTICE.md'), 'NOTICE.md'], [path.join(T, 'gitignore'), '.gitignore'],
  [path.join(T, 'web-mortal-README.md'), 'web-mortal/README.md'],
  [path.join(ROOT, 'ai', 'Mortal-S42', 'runtime', 'LICENSE'), 'LICENSE'],
  [path.join(ROOT, 'README.md'), 'docs/server-mode.md'],
];

// ---- 안전 점검 ----
const problems = [];
const TEXT = /\.(html|css|js|mjs|json|md|txt|py|rs|toml|lock|yml|yaml)$/i;
const FORBIDDEN = [
  [/megas4\.com\/[a-z0-9]{20,}/i, 'S4 계정 ID가 들어간 주소'], [/\b[a-z0-9]{36}\/test1\b/i, 'S4 계정 ID 형태'],
  ...(personalPattern() ? [[personalPattern(), '개인 식별 정보(시스템 사용자명/git 이메일/MJP_EXTRA_FORBIDDEN)']] : []),
  [/<mjloggm\s+ver=/i, '대국 로그(XML)'], [/tenhou\.net\/0\/\?log=[0-9a-z-]{20,}/i, '특정 대국 로그 링크'], [/\b20\d{8}gm-[0-9a-f]{4}-0000-[0-9a-f]{8}\b/, '대국 로그 ID'],
];
const all = [...uniq.map(f => [path.join(ROOT, f), f]), ...generated.map(([s, d]) => [s, d])];
for (const [abs, rel] of all) {
  if (!fs.existsSync(abs)) { problems.push(`${rel}: 원본 없음 (${abs})`); continue; }
  if (fs.statSync(abs).size > 5e6) problems.push(`${rel}: 5MB 초과`);
  if (!TEXT.test(rel)) continue;
  const t = fs.readFileSync(abs, 'utf8');
  for (const [re, what] of FORBIDDEN) { const m = t.match(re); if (m) problems.push(`${rel}: ${what} 발견 → "${m[0].slice(0, 60)}"`); }
}
if (problems.length) { console.error('중단 — 공개하면 안 되는 내용이 있습니다:\n  ' + problems.join('\n  ')); process.exit(1); }

const bytes = all.reduce((s, [a]) => s + fs.statSync(a).size, 0);
console.log(`대상: ${all.length}개 파일 (${(bytes / 1e6).toFixed(2)}MB) → ${DEST}${DRY ? '  [dry-run: 복사 안 함]' : ''}`);
const groups = {};
for (const [, rel] of all) { const k = rel.split('/').slice(0, rel.startsWith('web-mortal/') ? 2 : 1).join('/'); groups[k] = (groups[k] || 0) + 1; }
console.log(Object.entries(groups).map(([k, n]) => `${k}:${n}`).join('  '));
if (DRY) process.exit(0);

for (const [abs, rel] of all) {
  const out = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(abs, out);
}
console.log('복사 완료. 변경 내용을 검토한 뒤 직접 커밋/푸시하세요.');
