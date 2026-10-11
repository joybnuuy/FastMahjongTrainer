// web-mortal/app 배포물 조립: 기존 프런트엔드(public/)는 건드리지 않고 복사해서 쓴다.
// 사용: node web-mortal/tools/build_app.mjs [모델.onnx]   (기본: out/quant/qat-wo-lr1e-6.onnx)
// 손으로 관리하는 파일: app/index.html, app/app.css, app/js/provider.js, app/js/settings-ui.js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WM, '..');
const APP = path.join(WM, 'app');
const MODEL_SRC = path.resolve(process.argv[2] || path.join(WM, 'out', 'quant', 'qat-wo-lr1e-6.onnx'));
const REPO_URL = process.env.REPO_URL || '(저장소 주소를 여기에 — 공개 전에 SOURCE.md를 갱신하세요)';

const cp = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };
const size = p => (fs.statSync(p).size / 1e6).toFixed(2) + 'MB';

// 1) 기존 프런트엔드 모듈 + 스타일 (worker.js 포함, 원본 그대로)
for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js'))) cp(path.join(ROOT, 'public', 'js', f), path.join(APP, 'js', f));
cp(path.join(ROOT, 'public', 'style.css'), path.join(APP, 'style.css'));
cp(path.join(WM, 'mortal-web.js'), path.join(APP, 'js', 'mortal-web.js'));

// 2) wasm 인코더 코어 (wasm-bindgen 산출물)
for (const f of ['mortal_wasm_core.js', 'mortal_wasm_core_bg.wasm']) cp(path.join(WM, 'pkg', f), path.join(APP, 'vendor', 'core', f));

// 3) onnxruntime-web (WASM 전용 빌드, 외부 wasm 로딩 방식)
const ORT = path.join(WM, 'node_modules', 'onnxruntime-web');
for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cp(path.join(ORT, 'dist', f), path.join(APP, 'vendor', 'ort', f));
if (fs.existsSync(path.join(ORT, 'LICENSE'))) cp(path.join(ORT, 'LICENSE'), path.join(APP, 'vendor', 'ort', 'LICENSE'));
else fs.writeFileSync(path.join(APP, 'vendor', 'ort', 'LICENSE'), `ONNX Runtime — MIT License
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

// 4) 모델 + 버전 정보 (버전 = 파일 sha256 앞 12자, 캐시 키/쿼리에 사용)
const bytes = fs.readFileSync(MODEL_SRC);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
cp(MODEL_SRC, path.join(APP, 'model', 'mortal.onnx'));
fs.writeFileSync(path.join(APP, 'model', 'model.json'), JSON.stringify({
  name: 'Mortal-S42 (S42.8k) · 가중치 int8 + QAT 증류',
  file: 'mortal.onnx', version: sha.slice(0, 12), sha256: sha, bytes: bytes.length, license: 'Apache-2.0',
}, null, 2) + '\n');

// 5) 라이선스 문서
cp(path.join(ROOT, 'ai', 'Mortal-S42', 'runtime', 'LICENSE'), path.join(APP, 'LICENSE'));
fs.writeFileSync(path.join(APP, 'NOTICE.md'), `# 라이선스 고지 (NOTICE)

## 이 앱
GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). 전문: [LICENSE](LICENSE).
대응하는 소스 코드: [SOURCE.md](SOURCE.md).

## Mortal 런타임 (libriichi)
- 원저작: Equim-chan, <https://github.com/Equim-chan/Mortal>, AGPL-3.0-or-later.
- 이 앱의 \`mortal_wasm_core.wasm\`은 위 소스 중 상태 추적/관측 인코딩 부분만 WebAssembly로 빌드한 파생물입니다.
  변경 사항: Python 바인딩(PyO3/numpy), 멀티스레드·파일 입출력 관련 의존성 제거, wasm-bindgen 인터페이스 추가.
  (빌드 입력은 Mortal-S42 배포본의 runtime/ 디렉터리, upstream commit 0cff2b52982be5b1163aa9a62fb01f03ce91e0d2.)

## Mortal 모델 가중치
- 원본: Mortal-S42 (체크포인트 S42.8k), Hugging Face \`haor/Mortal-S42\`, Apache-2.0 — <https://www.apache.org/licenses/LICENSE-2.0>.
- **변경됨(Apache-2.0 §4(b))**: \`model/mortal.onnx\`는 원본 가중치를 ONNX로 변환하고, 대부분의 합성곱 가중치를 int8(채널별)로,
  나머지를 fp16으로 저장하며, 양자화 오차를 줄이기 위해 원본 모델을 교사로 한 증류 미세조정(QAT)을 거친 파생물입니다.
  미세조정 입력으로 공개 대국 로그에서 만든 관측 텐서를 사용했으나 로그 자체는 포함하지 않습니다.
- 모델 파일 sha256: \`${sha}\`

## onnxruntime-web
MIT License, Microsoft. \`vendor/ort/\`.

## 데이터
이 배포물에는 대국 로그가 포함되어 있지 않습니다. 사용자가 설정한 저장소/파일에서 브라우저가 직접 읽습니다.
`);
fs.writeFileSync(path.join(APP, 'SOURCE.md'), `# 소스 코드

이 앱(및 wasm 모듈)에 대응하는 소스 코드: ${REPO_URL}

- \`web-mortal/wasm-core/\` — libriichi 파생 wasm 코어 (AGPL-3.0-or-later)
- \`web-mortal/derive_core.py\` — upstream에서 필요한 부분을 추출·변환하는 스크립트
- \`web-mortal/export_onnx.py\`, \`quantize.py\`, \`weight_only.py\`, \`qat.py\` — 모델 변환/양자화/미세조정
- \`public/js/\`, \`web-mortal/app/\` — 프런트엔드
`);

console.log('앱 조립 완료:', APP);
console.log(`  모델 ${size(path.join(APP, 'model', 'mortal.onnx'))} (v${sha.slice(0, 12)}) · wasm 코어 ${size(path.join(APP, 'vendor/core/mortal_wasm_core_bg.wasm'))} · ort wasm ${size(path.join(APP, 'vendor/ort/ort-wasm-simd-threaded.wasm'))}`);
