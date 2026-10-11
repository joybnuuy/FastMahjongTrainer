// V5 배포물 조립: v5/public (손으로 관리하는 화면·코어) + wasm 코어 + onnxruntime-web + 모델 + 라이선스 문서 → v5/dist
// 사용: node v5/tools/build.mjs [모델.onnx]     환경변수 REPO_URL 로 SOURCE.md 의 소스 주소 지정
// v5/dist 는 통째로 지우고 다시 만든다 (그 밖의 폴더는 건드리지 않음).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const V5 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(V5, '..');
const WM = path.join(ROOT, 'web-mortal');
const SRC = path.join(V5, 'public'), DIST = path.join(V5, 'dist');
const MODEL_SRC = path.resolve(process.argv[2] || path.join(WM, 'out', 'quant', 'qat-wo-lr1e-6.onnx'));
const REPO_URL = process.env.REPO_URL || 'https://github.com/joybnuuy/FastMahjongTrainer';

const cp = (src, dst) => { if (!fs.existsSync(src)) throw new Error('없음: ' + src); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };
const copyTree = (src, dst) => { for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); e.isDirectory() ? copyTree(s, d) : cp(s, d); } };
const size = p => (fs.statSync(p).size / 1e6).toFixed(2) + 'MB';

if (path.dirname(DIST) !== V5) throw new Error('비정상 DIST 경로');
fs.rmSync(DIST, { recursive: true, force: true });

// 1) 화면(V4 + v1/) 과 코어
copyTree(SRC, DIST);
cp(path.join(WM, 'mortal-web.js'), path.join(DIST, 'core', 'mortal-web.js'));

// 2) wasm 인코더 코어
for (const f of ['mortal_wasm_core.js', 'mortal_wasm_core_bg.wasm']) cp(path.join(WM, 'pkg', f), path.join(DIST, 'vendor', 'core', f));

// 3) onnxruntime-web (WASM 전용, 외부 wasm 로딩 방식)
const ORT = path.join(WM, 'node_modules', 'onnxruntime-web');
for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cp(path.join(ORT, 'dist', f), path.join(DIST, 'vendor', 'ort', f));
fs.writeFileSync(path.join(DIST, 'vendor', 'ort', 'LICENSE'), `ONNX Runtime — MIT License
https://github.com/microsoft/onnxruntime/blob/main/LICENSE

MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);

// 4) 엔진(모델) 레지스트리: v5/engines.json 의 각 엔진을 model/<id>/mortal.onnx 로 복사하고 model/engines.json 을 만든다
//    버전 = 파일 sha256 앞 12자 (캐시 키/쿼리/설치 기록에 사용). 인자로 .onnx 경로를 주면 첫 엔진의 source 를 대신한다(개발용).
const regSrc = JSON.parse(fs.readFileSync(path.join(V5, 'engines.json'), 'utf8'));
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const engines = [];
regSrc.engines.forEach((e, i) => {
  if (!ID_RE.test(e.id)) throw new Error('엔진 id 가 올바르지 않음: ' + e.id);
  if (engines.some(x => x.id === e.id)) throw new Error('엔진 id 중복: ' + e.id);
  const src = path.resolve(i === 0 && process.argv[2] ? process.argv[2] : path.join(ROOT, e.source));
  if (!fs.existsSync(src)) { if (e.optional) { console.warn('건너뜀(파일 없음, optional):', e.id); return; } throw new Error(`엔진 파일이 없음: ${e.id} → ${src}`); }
  const buf = fs.readFileSync(src);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const file = `${e.id}/mortal.onnx`;
  cp(src, path.join(DIST, 'model', file));
  engines.push({ id: e.id, name: e.name, kind: e.kind || 'base', description: e.description || '', file, version: sha.slice(0, 12), sha256: sha, bytes: buf.length, license: e.license, base: e.base || '', changes: e.changes || '' });
});
if (!engines.length) throw new Error('배포할 엔진이 없음');
if (!engines.some(e => e.id === regSrc.default)) throw new Error('default 엔진이 목록에 없음: ' + regSrc.default);
fs.writeFileSync(path.join(DIST, 'model', 'engines.json'), JSON.stringify({ format: 1, default: regSrc.default, engines }, null, 2) + '\n');

// 5) 라이선스 문서
// 엔진마다 원본·라이선스·변경 사실(Apache-2.0 §4(b))·파일 해시를 적는다. 엔진이 늘어도 v5/engines.json 만 고치면 된다.
const BT = String.fromCharCode(96);   // 백틱 (중첩 템플릿 이스케이프를 피하려고 문자 코드로 만든다)
const engineNotice = engines.map(e => [
  `### ${e.name}  (id: ${BT}${e.id}${BT})`,
  `- 원본: ${e.base}, ${e.license} — <https://www.apache.org/licenses/LICENSE-2.0>`,
  `- **변경됨(Apache-2.0 §4(b))**: ${BT}model/${e.file}${BT} — ${e.changes}`,
  `- 파일 sha256: ${BT}${e.sha256}${BT}`,
].join('\n')).join('\n\n');
cp(path.join(ROOT, 'ai', 'Mortal-S42', 'runtime', 'LICENSE'), path.join(DIST, 'LICENSE'));
fs.writeFileSync(path.join(DIST, 'NOTICE.md'), `# 라이선스 고지 (NOTICE)

## 이 앱
GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). 전문: [LICENSE](LICENSE).
대응하는 소스 코드: [SOURCE.md](SOURCE.md).

## Mortal 런타임 (libriichi)
- 원저작: Equim-chan, <https://github.com/Equim-chan/Mortal>, AGPL-3.0-or-later.
- 이 앱의 \`vendor/core/mortal_wasm_core_bg.wasm\`은 위 소스 중 상태 추적/관측 인코딩 부분만 WebAssembly로 빌드한 파생물입니다.
  변경 사항: Python 바인딩(PyO3/numpy), 멀티스레드·파일 입출력 관련 의존성 제거, wasm-bindgen 인터페이스 추가.
  (빌드 입력은 Mortal-S42 배포본의 runtime/ 디렉터리, upstream commit 0cff2b52982be5b1163aa9a62fb01f03ce91e0d2.)

## Mortal 모델 가중치 (엔진)
${engineNotice}

## 패 이미지
\`v4/tiles/libre/*.svg\` — libreriichi-assets (<https://codeberg.org/davidgomez/libreriichi-assets>), **CC0 1.0** (퍼블릭 도메인).
패별 개별 SVG로 추출한 것이며 라이선스 사본은 \`v4/tiles/libre/LICENSE-CC0.txt\`에 있습니다.

## onnxruntime-web
MIT License, Microsoft. \`vendor/ort/\`.

## 데이터
이 배포물에는 대국 로그가 포함되어 있지 않습니다. 사용자가 설정한 저장소/파일에서 브라우저가 직접 읽습니다.
`);
fs.writeFileSync(path.join(DIST, 'SOURCE.md'), `# 소스 코드

이 앱(및 wasm 모듈)에 대응하는 소스 코드: ${REPO_URL}

- \`v5/public/\` — 런처, 화면(\`v4/\`, \`v1/\`), 코어(\`core/\`: 데이터 제공자, 설정, 오답노트)
- \`web-mortal/wasm-core/\` — libriichi 파생 wasm 코어 (AGPL-3.0-or-later)
- \`web-mortal/derive_core.py\` — upstream에서 필요한 부분을 추출·변환하는 스크립트
- \`web-mortal/export_onnx.py\`, \`quantize.py\`, \`weight_only.py\`, \`qat.py\` — 모델 변환/양자화/미세조정
`);

const total = (function sum(d) { return fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? sum(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0); })(DIST);
console.log(`V5 조립 완료: ${DIST} (${(total / 1e6).toFixed(1)}MB)`);
console.log(`  엔진 ${engines.map(e => `${e.id} ${(e.bytes / 1e6).toFixed(2)}MB(v${e.version})`).join(', ')} · wasm 코어 ${size(path.join(DIST, 'vendor/core/mortal_wasm_core_bg.wasm'))} · ort wasm ${size(path.join(DIST, 'vendor/ort/ort-wasm-simd-threaded.wasm'))}`);
