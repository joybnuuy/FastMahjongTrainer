# web-mortal: Mortal을 브라우저/아이폰에서 돌리기 (조사 노트)

목표: 지금 `server.js` + `ai/analyze.py`(Python/CUDA)가 하는 "판단 지점별 Q값 계산"을
정적 웹페이지(브라우저 내 추론)로 옮기고, 가능하면 아이폰에서도 쓰기.

## 1. 로컬에서 확인한 사실
- 가중치: `ai/Mortal-S42/weights/s42-inference.pth` (43.7MB, `{mortal, current_dqn}`)
- 모델: `Brain(version=4, conv_channels=192, num_blocks=40)` + `DQN(version=4)`
- 입력 `(1012, 34)` float32, 마스크 `(46,)` bool, 출력 Q값 46개 (`inference.py` smoke 계약)
- 현재 흐름: mjai 이벤트 → `libriichi.mjai.Bot.react()` → (Rust가 상태추적+obs 인코딩+마스크) → Python 모델 → Q값
- `libriichi` Cargo 기본 feature = `pymod`(pyo3 extension-module) + `mimalloc`. 의존성에 `pyo3`, `numpy`, `rayon`, `indicatif`, `glob` 등이 무조건 포함되어 있음.
- PyO3 결합 지점(grep 결과): `state/player_state.rs`, `state/obs_repr.rs`(`encode_obs`가 numpy 반환), `state/action.rs`, `state/getter.rs`, `consts.rs`, `mjai/bot.rs`, `agent/mortal.rs`(엔진 호출, rayon). 즉 **상태/인코딩 로직 자체는 순수 Rust지만 PyO3 어노테이션이 곳곳에 섞여 있어서**, wasm 타깃으로 쓰려면 feature 분리(`pymod` off) + numpy 반환부를 `Vec<f32>`로 바꾸는 작업이 필요. 이 부분이 이번 프로젝트의 핵심 공수.

## 2. 접근 각도별 결과

### A. 순수 브라우저 (정적 호스팅 + onnxruntime-web)  ← 1순위
- 모델: PyTorch → ONNX → `onnxruntime-web`. 백엔드는 WebGPU 우선, 없으면 WASM(CPU).
- 규모: 약 1000만 파라미터, 추론당 ~0.6 GFLOP(추정) → WASM CPU로도 충분할 가능성 높음. 실측 필요.
- onnxruntime-web 문서상 WebGPU 백엔드는 여전히 "experimental" 표기, WebGL은 maintenance mode. → WebGPU는 옵션, WASM 폴백 필수.
- 멀티스레드 WASM은 SharedArrayBuffer → COOP/COEP(cross-origin isolation) 필요. 정적 호스팅에서 헤더를 못 주면 단일 스레드로 폴백(또는 coi-serviceworker). 처음엔 단일 스레드로 충분할 것.
- 인코더(`libriichi`)는 별도로 Rust→wasm 빌드 필요 (위 1번 참조). 기존 "Mortal을 wasm으로 돌린 공개 프로젝트"는 검색에서 못 찾음 → 직접 포팅해야 할 가능성이 큼.

### B. iPhone Safari / 홈 화면 PWA
- WebGPU: iOS 26(Safari 26)부터 기본 활성화로 보도됨. iOS 18 이하는 미지원/제한적. 일부 기기·버전에서 크래시/깜빡임 버그 보고(iOS 26.0.1, 26.4). → **WASM 폴백 경로가 사실상 필수**, WebGPU는 가속 옵션.
- PWA: Service Worker 지원은 되지만 iOS는 캐시 용량/만료 정책이 불안정하다는 보고가 있음. 43MB 모델을 캐시에 믿고 두기엔 위험 → fp16/양자화로 줄이고 IndexedDB 등에 저장 + 재다운로드 경로 확보.
- 천봉 로그 가져오기는 CORS 때문에 정적 호스팅만으로는 불가 → 작은 프록시(Cloudflare Worker 등) 또는 "로그 붙여넣기/파일 업로드" 방식.

### C. 네이티브 셸로 감싸기 (WKWebView / Capacitor / Tauri mobile)
- 정적 사이트 + 모델을 앱 번들에 넣고 WKWebView에서 로드 → 오프라인 확실, 캐시 만료 문제 없음.
- WKWebView의 WebGPU는 iOS 26에서 기본 활성화로 알려져 있으나 "WKWebView 명시 확인"은 못 찾음(Apple 포럼 답변이 간접 근거). 실기기 테스트 필요.
- 이 경로의 이점: 필요하면 WASM 대신 **Core ML / 네이티브 Rust(`libriichi` aarch64-apple-ios) 브리지**로 갈아탈 수 있음 ("90% 웹 + α"의 α).
- 단점: 개발자 계정/사이드로딩 이슈(무료 Apple ID는 7일 만료), 앱스토어 배포 시 AGPL 문제.
- Capacitor/Tauri + onnxruntime-web 조합의 실사용 보고는 검색에서 못 찾음 → 미검증.

### D. 폰에서 로컬 서버를 띄우는 앱 (a-Shell, iSH, Pyto 등)
- iSH: `python3 -m http.server`로 정적 서빙한 사례 문서 있음. a-Shell은 서버 가능 여부 문서 못 찾음(미검증).
- 의미: 앱 심사/서명 없이 "내 폰에서 localhost 서빙 → Safari로 접속" 가능. 다만 Safari에서 `http://localhost`는 secure context라 service worker/WebGPU 동작은 되지만, iOS 백그라운드에서 서버가 죽는 문제가 있을 수 있음.
- 폰에서 Python+PyTorch+libriichi를 그대로 돌리는 건 비현실적. 이 각도는 "정적 서버 대용"으로만 의미 있음.

### E. 이미 존재하는 모바일 Mortal 앱 (검색 결과)
- 독립 실행형 Mortal iOS/Android 앱은 찾지 못함.
- 확인된 것: 웹 서비스(mjai.ekyu.moe)로 로그 리뷰, Riichi City는 게임 내에 Mortal 리뷰를 통합. Akagi/Akagi-NG는 데스크톱 어시스턴트(libriichi 네이티브 사용).
- 관련 Rust 생태계: RiichiEnv(Mortal 호환 MJAI 인터페이스), riichi-tools-rs(WASM용 별개 라이브러리). Mortal 자체 wasm 빌드는 못 찾음.

### F. 서버 추론 + 모바일은 클라이언트 (대안/폴백)
- 지금 구조 그대로 두고 폰은 접속만. 가장 쉽지만 "정적 서빙" 목표와는 다름. 폴백 용도.

## 3. 결론/권장 순서
1. **ONNX 내보내기 + onnxruntime-web 패리티 검증** (PyTorch Q값과 일치?) — 가장 불확실, 먼저.
2. **libriichi 인코더 wasm 빌드** (pymod feature 분리, numpy → Vec<f32>). 안 되면 Rust 코어를 JS로 재작성하는 대안 검토.
3. 기존 `cache/*.ai.json`과 브라우저 결과 비교(회귀 테스트).
4. iPhone 실기기: Safari PWA(WASM 폴백) → 필요하면 WKWebView 셸.

## 4. 열린 질문 / 미검증
- onnxruntime-web WebGPU가 iOS 26 Safari/WKWebView에서 실제로 이 모델을 돌리는가
- WASM 단일 스레드에서 판단 1회 지연 시간 (iPhone 실측)
- fp16/int8 양자화 후 Q값 오차 허용 범위 (채점 기준: Q 격차 0.1/0.7)
- AGPL: wasm 배포 시 소스 제공 방법

## Sources
- https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/
- https://npmjs.com/package/onnxruntime-web
- https://appdevelopermagazine.com/webgpu-in-ios-26/
- https://developer.apple.com/forums/thread/770862
- https://bugs.webkit.org/show_bug.cgi?id=301627
- https://www.igeeksblog.com/how-to-run-web-server-on-iphone/
- https://backiee.wasmer.app/http_github_com/Xe-Persistent/Akagi-NG
- https://backiee.wasmer.app/http_github_com/smly/RiichiEnv
- https://riichimahjong.net/blog/mahjongai/

## 5. 진행 로그
### 2026-10-10 Step 1: ONNX + onnxruntime-web 패리티 — 완료
- `export_onnx.py`: Brain+DQN을 하나의 ONNX(`out/mortal.onnx`, 43.7MB, opset 17)로 내보냄. 입력 obs(N,1012,34) float32 + mask(N,46) bool → q(N,46), 불가능 행동은 -inf.
- 패리티: PyTorch vs onnxruntime(Python CPU) 최대 오차 1.5e-5, argmax·마스크 일치.
- `test_wasm_node.mjs`: onnxruntime-web WASM 백엔드(Node)에서 최대 오차 6.7e-6.
- 지연(이 PC, Node, WASM+SIMD): 1스레드 batch1 57ms / batch2 101ms, 4스레드 batch1 37ms.
  → 폰이 3~5배 느려도 한 판단 ~0.2-0.3s 예상. 단일 스레드 WASM으로 충분. WebGPU는 필수 아님.
- 모델 자체는 문제 없음. 남은 큰 일은 Step 2(libriichi 인코더 wasm).

### 2026-10-10 Step 2~3: libriichi → wasm + 엔드투엔드 패리티 — 완료
- `derive_core.py`: upstream `libriichi/src`에서 필요한 모듈(algo, state, mjai/event, consts, tile, hand …)만 `wasm-core/src`로 복사하고 PyO3 어노테이션/`register_module`/numpy 래퍼를 자동 제거. (agent, arena, dataset, stat, bot, py_helper는 제외)
- `wasm-core/`: 별도 crate. 의존성에서 pyo3, numpy, rayon, mimalloc 제거. `boomphf`는 default-features 끔(rayon 방지), `ahash`는 `compile-time-rng`(getrandom 회피).
  `src/wasm.rs`가 `Session{ new(seat), update(line, can_act)->bool, encode(kan)->Float32Array(obs+mask), fork(), … }` 노출.
- 빌드 (이 PC는 MSVC 없음 → gnu 툴체인 사용, Git Bash의 `link`가 MSVC link.exe를 가려서 msvc 툴체인은 실패):
  ```
  cd web-mortal/wasm-core
  cargo +stable-x86_64-pc-windows-gnu build --release --target wasm32-unknown-unknown
  wasm-bindgen --target web --out-dir ../pkg target/wasm32-unknown-unknown/release/mortal_wasm_core.wasm
  ```
  결과 wasm 1.2MB (+ onnx 43.7MB).
- `mortal-web.js`: 브라우저/Node 공용 `MortalWeb.analyze(events, [{seat, idx}])` — `ai/analyze.py`와 같은 입출력(q 압축배열, mask 문자열, reach 분기).
- 검증 (`test_e2e.mjs`, 기준값은 `ref_cpu.py`의 Python CPU fp32):
  - 일반 6게임: 132지점 mask 전부 일치, 최대 |dq| = 6e-6
  - 리치 분기 포함 6게임: 132지점 / reach fork 11개, mismatch 0, 최대 |dq| = 6.7e-6
  - 기존 `cache/*.ai.json`(CUDA+AMP=fp16)과는 최대 ~1e-2 차이 — fp16 노이즈이며 wasm 쪽 오류 아님.
- 속도: Node, 단일 스레드 WASM, 66지점(3게임) 약 2.3초.
- 다음: 정적 데모 페이지(브라우저/아이폰 실측), 천봉 로그 프록시 또는 붙여넣기, 모델 fp16/캐시 전략, AGPL 소스 제공 방식.

### 2026-10-10 Step 4: 양자화 실험 (fp16 / int8) — 천봉 로그 기반 보정·평가
- 데이터: `gen_dataset.mjs` — `cache/`의 천봉 4인 대국 679판 중 결정적 셔플로 보정 60판(2,396샘플), 평가 40판(1,601샘플, 합법 행동 2개 이상 1,531개)을 뽑음. 모든 좌석의 "행동 가능 시점"에서 확률 샘플링, 보정/평가는 서로 다른 대국.
- 보정: 보정셋 앞 512샘플. 평가: fp32 원본 Q 대비 (Python ORT CPU, `quantize.py`) + onnxruntime-web WASM(`bench_variants_node.mjs`).
- 지표: 이 앱 채점(Q 격차 0.1/0.7)과 직결되도록 "자기 최선 대비 격차"의 오차(`gapΔ`, V 오프셋은 상쇄)와 채점 구간 변동률(`binflip`)을 사용.

| 변형 | MB | gz MB | gapΔ 평균 | gapΔ p99 | binflip | top1 일치 | 선택손실>0.1 |
|---|---|---|---|---|---|---|---|
| fp32 원본 | 43.7 | 40.3 | – | – | – | – | – |
| **fp16 저장** (연산은 fp32) | 22.1 | 20.2 | 0.00025 | 0.0012 | 0 | 100% | 0 |
| int8 static, conv+gemm 전부 | 12.4 | 10.0 | 0.104 | 0.36 | 0.45% | 99.0% | 0.26% |
| int8 static, conv만 | 15.7 | 13.7 | 0.076 | 0.29 | 0.41% | 99.3% | 0.07% |
| int8 static, conv만 + 첫 conv·마지막 Gemm 제외 | 17.5 | 15.5 | 0.060 | 0.22 | 0.28% | 99.8% | 0 |
| 위 + 나머지 fp32를 fp16 저장 (**int8-conv-edge+fp16**) | 13.6 | 11.9 | 0.060 | 0.22 | 0.27% | 99.4% | 0.07% |
| int8-conv+fp16 | 13.1 | 11.2 | 0.078 | 0.30 | 0.42% | 99.6% | 0 |
| int8-all+fp16 | 12.4 | 10.0 | 0.104 | 0.36 | 0.45% | 99.0% | 0.26% |

- Percentile(99.999) 보정은 MinMax보다 p99가 더 나빠 이득 없음. Entropy 보정은 MinMax와 스케일이 완전히 동일(284개 모두) → 이 환경에서 별개 결과가 아니라고 판단, 후보에서 제외.
- `quantize_dynamic`(Conv/Gemm)은 ORT가 Gemm을 MatMul로 바꾸는 단계에서 shape 오류로 로드 실패 → 포기.
- onnxruntime-web(WASM, 1스레드, Node) 속도: fp32 ~53ms, fp16 ~49ms(Cast는 접힘, 첫 측정의 82ms는 노이즈), int8 변형 ~32ms. 모든 변형이 WASM에서 로드/실행됨 (QDQ → QLinearConv 융합).
- 결론(잠정): 무손실을 원하면 **fp16 저장(22MB)**. 크기가 더 중요하면 **int8-conv-edge+fp16(13.6MB)** 이 정확도/크기 균형점. int8-all(12.4MB)은 1MB 덜 줄이는 대신 오차가 약 1.7배라 비추. 오차를 더 줄이려면 AdaRound/BRECQ류 또는 QAT+증류(교사=fp32, 데이터=천봉 로그) 필요 — 아직 미시도.
- 평가셋이 1.5천 샘플이라 0.1% 미만 차이는 노이즈. ort-web 속도 측정은 60샘플·단일 실행이라 ±20% 흔들림.

### 2026-10-10 Step 5: 레이어 민감도 + 혼합정밀 파레토 (int8 ↔ fp16)
- `sensitivity.py` (PyTorch/GPU): 후보 84개(Conv 82 + 큰 Linear 2). 보정셋 [0,512)=활성 범위, [512,1536)=민감도 측정, 평가셋은 미사용.
  - A) ablation: 레이어 하나만 int8 시뮬레이션(가중치 per-channel 대칭 + 입력 활성 uint8 minmax) → fp32 대비 gapΔ
  - B) 경험적 Fisher: 모델 자신의 정책 softmax(Q)에서 행동 샘플 → 가중치 기울기² 누적, Ω = Σ F·(ΔW)²  (HAWQ 계열)
  - 결과: 단독으로 민감한 레이어는 4개뿐 — `net.43`(192→32 conv, 18K 파라미터, gapΔ 0.047), `net.0`(첫 conv 583K, 0.026), `net.46`(마지막 Linear 1088→1024, 1.1M, 0.022), `dqn.net`(Q head, 48K, 0.013). 나머지 80개 residual conv는 각각 0.001~0.007.
  - Spearman(ablation, Fisher) = 0.285 — Fisher는 가중치 잡음만 보고 활성 양자화를 못 봐서 예측력이 낮음. Fisher 상위는 앞쪽 레이어에 몰림(깊이 순 대조군과 같은 결과).
- `pareto.py`: 민감도 순으로 상위 k개를 양자화 제외(fp16 저장) + 나머지 int8 QDQ, 평가셋(1,531 선택 지점)에서 fp32 대비 측정:

| 변형 | fp16로 둔 레이어 | MB | gapΔ 평균 | gapΔ p99 | binflip | top1 |
|---|---|---|---|---|---|---|
| fp16 전체 | 전부 | 22.1 | 0.00025 | 0.001 | 0 | 100% |
| abl-k48 | 민감 상위 48 | 18.3 | 0.021 | 0.087 | 0.11% | 99.7% |
| abl-k8 | 상위 8 | 14.1 | 0.034 | 0.147 | 0.23% | 99.6% |
| **abl-k4** | net.43, net.0, net.46, dqn.net | **13.7** | **0.037** | 0.153 | 0.24% | 99.5% |
| abl-k2 | net.43, net.0 | 12.5 | 0.050 | 0.191 | 0.38% | 99.4% |
| abl-k0 | 없음(전부 int8) | 11.9 | 0.101 | 0.347 | 0.45% | 99.3% |
| (이전) int8-conv-edge+fp16 | 첫 conv, dqn.net | 13.6 | 0.060 | 0.216 | 0.27% | 99.4% |
| fis-k4 / depth-k4 | (같은 집합: 앞쪽 레이어) | 12.8 | 0.083 | 0.278 | 0.30% | 99.6% |
| fis-k16 | Fisher 상위 16 | 13.9 | 0.041 | 0.159 | 0.21% | 99.5% |
| abl-k16 | 상위 16 | 14.9 | 0.031 | 0.138 | 0.27% | 99.5% |

- 결론: **abl-k4 (13.7MB)** 가 무릎. 이전 edge 휴리스틱(13.6MB, gapΔ 0.060) 대비 같은 크기에서 오차 약 38% 감소. 이전 휴리스틱은 가장 민감한 `net.43`을 양자화해 놓쳤음 (파라미터 18K라 fp16로 두는 비용은 사실상 0).
- k=4 이후는 수확체감: 크기 +0.4MB(k=8)에 gapΔ 0.037→0.034, k=48(18.3MB)에서도 0.021. 남은 오차는 80개 residual conv의 누적 양자화 잡음 → 더 줄이려면 AdaRound/BRECQ 또는 QAT+증류(교사=fp32, 데이터=천봉 로그) 필요.
- 주의: top1/binflip의 0.1%p 차이는 노이즈(평가 1.5천 샘플). gapΔ 평균이 가장 안정적인 지표. 민감도는 단일 레이어 ablation이라 상호작용을 무시하지만 파레토는 실제 양자화로 검증함. onnxruntime-web 속도는 측정마다 편차가 커서(32~56ms) int8의 속도 이득은 확정하지 못함.

### 2026-10-10 Step 6: QAT+증류 (1단계, 사람 라벨 없음) → 오차 원천 분해 → 가중치 전용 int8로 방향 전환
- 데이터 분리: `gen_dataset.mjs train N`은 `calib.json`/`eval.json`에 기록된 대국 ID를 직접 제외 (캐시가 679→682판으로 늘어 셔플 순서가 바뀌며 한 번 누수가 생겼고, 폐기 후 수정함). 학습셋 582판 / 58,048샘플(8GB), 보정·평가와 교집합 0.
- `qat.py`: 교사 fp32 → 학생(민감 상위 4개 제외 80 conv에 입력·출력 활성 uint8 + 가중치 per-channel int8 fake-quant, STE). 손실 = 격차 오차(smooth-L1, 최선 근처 행동 4배 가중) + 10×KL. 시뮬레이션 val(학습 전) gapΔ 0.0372 ≈ 실제 ORT 0.0369 → 시뮬레이션 신뢰 가능.
  - lr 3e-5는 학습이 불안정(200스텝에서 악화), lr 1e-5 + 코사인이 안정적.
  - 결과(평가셋, 실제 ORT int8+fp16 13.7MB): PTQ 0.0369 → 1.4만 샘플 2000스텝 0.0361 → 5.8만 샘플 3000스텝 **0.0355** (약 4% 개선). 과적합 아님(학습 샘플 0.0333 vs val 0.0353).
- `diag_error_source.py` — 개선이 작은 이유: 오차 대부분이 활성값 양자화.
  - 가중치만 int8 **0.0067** / 활성 입력만 0.0247 / 활성 출력만 0.0271 / 전부 0.0372
  - 활성 범위를 percentile로 자르면 더 나빠짐 (99.999%: 0.042, 99.99%: 0.106, 99.9%: 0.388) → 이 모델 활성값은 이상치가 중요.
  - 가중치 학습으로는 전체 오차의 ~18%만 건드릴 수 있어 QAT 이득이 작음.
- 방향 전환: 목적이 다운로드 크기이므로 활성은 fp32로 두고 **가중치만 int8 저장**(`weight_only.py`: int8 initializer + per-channel scale + DequantizeLinear, 나머지 fp32는 fp16 저장).

| 변형 (평가셋, fp32 대비) | MB | gapΔ 평균 | gapΔ p99 | binflip | top1 | 손실>0.1 |
|---|---|---|---|---|---|---|
| 활성+가중치 int8, 상위4 fp16 (이전 최선 `par-abl-k4`) | 13.7 | 0.0369 | 0.153 | 0.24% | 99.5% | 0.07% |
| **wo-keep-top2** (net.0, dqn.net만 fp16) | 12.2 | 0.0072 | 0.032 | 0.03% | 99.8% | 0 |
| **wo-keep-top4** (+net.1.res_unit.5/.2) | 12.4 | 0.0063 | 0.027 | 0.03% | 99.9% | 0 |
| wo-keep-top8 | 13.8 | 0.0054 | 0.024 | 0.04% | 99.7% | 0 |
| wo-keep-old4 (net.43,net.0,net.46,dqn.net) | 13.3 | 0.0066 | 0.031 | 0.03% | 99.8% | 0 |
| wo-all (전부 int8) | 11.6 | 0.0278 | 0.163 | 0.19% | 99.6% | 0.07% |
| 순수 fp16 | 22.1 | 0.00025 | 0.001 | 0 | 100% | 0 |

- 가중치 전용 민감도는 활성 포함 때와 완전히 다름: 단독 상위는 `net.0`(첫 conv, 0.0256)과 `dqn.net`(0.0077)뿐, 나머지는 ≤0.0025 (중앙값 0.00055). `net.43`은 이전에 가장 민감하다고 나왔지만 그건 활성(입력 범위) 때문이었고 가중치만 보면 0.0017.
- onnxruntime-web WASM: 가중치 int8 모델도 로드·실행 OK, 런타임 속도는 fp32/fp16과 동일 범위 (프로세스별 반복 측정 48~80ms, 이 PC는 반복 중 느려지는 편차 있음). 활성 int8(`par-abl-k4`)만 안정적으로 ~34ms로 빠름 → 속도가 필요하면 그쪽, 크기가 목적이면 가중치 전용.

### 2026-10-11 Step 7: 가중치 전용 QAT+증류 (사람 라벨 없음) — 결과
- 설정: 가중치만 int8 fake-quant (활성 fp32), fp 유지 = 가중치 민감도 상위 4개(net.0, dqn.net, net.1.res_unit.5/.2), 학습 5.8만 샘플, AdamW, 코사인, 증류 손실(격차 smooth-L1 + 10×KL). 학생 ≈ 교사라 손실이 거의 0이어서 lr이 크면 Adam이 노이즈를 정규화해 가중치를 흔듦.
  - lr 1e-5 / 3000스텝: val gapΔ가 학습 중 0.024까지 악화 후 0.0073으로 회복 → 최종 평가셋 gapΔ 0.00699 (PTQ 0.00628보다 **나쁨**).
  - lr 1e-6 / 2000스텝: val 0.0064 → 0.0034 로 단조 개선, 학습셋 샘플도 0.0061 → 0.0027 (과적합 아님).
- 최종(평가셋 1,531 지점, 실제 ORT 가중치 int8+fp16 저장, fp32 대비):

| | MB | gapΔ 평균 | gapΔ p99 | binflip | top1 | KL |
|---|---|---|---|---|---|---|
| PTQ wo-keep-top4 | 12.4 | 0.00628 | 0.0274 | 0.03% | 99.87% | 4e-6 |
| **QAT wo (lr 1e-6, 2000스텝)** | 12.4 | **0.00337** | **0.0172** | 0.03% | 99.87% | 2e-6 |
| 순수 fp16 | 22.1 | 0.00025 | 0.001 | 0 | 100% | ~0 |

- 하이퍼파라미터는 val(보정셋 뒤쪽 대국) 곡선으로만 선택했으나, 두 실행(lr 1e-5, 1e-6) 모두 평가셋 수치를 열어봄 → 평가셋에 대한 선택 편향 가능성은 작지만 0은 아님(2회).
- 산출물: `out/quant/qat-wo-lr1e-6.onnx` (+ `.pt` 튜닝 가중치). 활성 포함 QAT는 4% 개선에 그침(Step 6) → 이후 경로는 가중치 전용으로 확정.

### 2026-10-11 Step 8: MEGA S4를 정적 자산 저장소로 쓸 수 있는가 (실측)
- 공개 읽기: 가상 호스트 URL(`test1.s3.g.megas4.com/...`)은 익명 접근 시 400("SigV4 필요"). **경로 방식 URL**(`s3.g.megas4.com/<계정ID>/<버킷>/<키>`)은 익명 GET 200, 내용 바이트 동일, `Range` 206, `Accept-Ranges: bytes`.
- CORS: 별도 설정 없이 임의 `Origin`을 그대로 반사(`https://…`, `http://localhost:…`, `http://127.0.0.1:…` 확인), 프리플라이트 204(허용 메서드는 GET, 헤더 `range`). 사용자 Chrome에서 교차 출처 `fetch`/`Range` 성공.
- 함정 1 — 캐시: 응답에 `Vary: Origin`도 `Cache-Control`도 없음 → 브라우저가 `Last-Modified` 휴리스틱 캐시를 하고, 과거에 CORS 헤더가 달랐던 응답이 캐시에 남으면 기본 `fetch`가 CORS 오류. 쿼리 문자열(`?v=버전`)은 S4가 무시하므로 캐시 키만 바꿔 우회/버전 관리에 사용 가능. (패널에서 실패한 원인은 이 캐시 문제로 보이며, 초기 오염원은 설명하지 못함.)
- 함정 2 — MIME: `Content-Type: binary/octet-stream` → 모듈 스크립트 `import`는 Chrome이 거부("Expected a JavaScript-or-Wasm module script…"). 업로드 시 `--content-type` 반영 여부는 미확인.
- 함정 3 — 지연: 리전이 암스테르담(`s3.g` → `eu-amsterdam`), 이 PC에서 RTT ≈ 300ms. 새 연결 첫 요청 ≈ 1.2s(TCP 0.3 + TLS 0.3 + 요청 0.3), 연결 재사용 시 ≈ 0.3s. HTTP/2 미지원(h2 ALPN 협상 실패) → 브라우저 호스트당 동시 연결 6개. 작은 파일 수천 개를 따로 받는 구성은 비현실적 → 로그는 수십 개 샤드로 묶어야 함. Tokyo 리전이 2026-05에 추가됐다는 글이 있어 해당 리전 버킷이면 지연이 크게 줄 가능성(미확인).
- 크기 실측(캐시 685판 기준): 로그 평균 15KB(gzip 7.4KB), `ai.json` 평균 4.4KB. 2000판 ≈ 29MB(gzip 약 14MB) + 분석 8MB + 모델 12.4MB + wasm 1.2MB ≈ 50MB.
- 잠정 결론: 모델/로그 샤드 같은 큰 정적 파일 저장소로는 사용 가능. HTML/JS는 Content-Type 확인 전까지 다른 호스트 권장.

### 2026-10-11 Step 9: 정적 앱(`web-mortal/app/`) + 사용자 데이터 저장소 구조 — 동작 확인
- 구조: github.io에는 앱·wasm 코어·모델·ort 런타임만(데이터 없음), 로그는 사용자가 설정에 넣은 저장소 URL(예: MEGA S4)에서 브라우저가 직접 받음. 설정은 `localStorage`(`mjp-store-v1`), 모델은 IndexedDB 캐시(버전=sha256 앞 12자).
- 기존 프런트엔드(`public/js/*`, `style.css`)는 한 줄도 수정하지 않고 복사해 사용. `provider.js`가 `fetch('/api/game')`만 가로채 `{id, xml, ai}`를 돌려줌(저장소 샤드/로컬 가져오기 → 브라우저 안 Mortal 분석).
- 저장소 형식: `manifest.json`({format:1, version, shards:[{file, n, bytes, ids[]}]}) + `shard-NNN.json.gz`({games:[{id, xml, ai?}]}). 685판 → 샤드 7개 4.5MB. 샤드는 `?v=<manifest.version>`, manifest는 분 단위 `?t=`로 캐시 키를 바꿔 호출(S4에 Cache-Control/Vary 없음 대응).
- 빌드: `node web-mortal/tools/build_app.mjs`(앱 조립 + NOTICE/LICENSE/SOURCE 생성), `node web-mortal/tools/build_shards.mjs`(저장소용 샤드), `node web-mortal/tools/serve.mjs`(앱 8770 + 저장소 8771(CORS) 개발 서버, `HOST=0.0.0.0`으로 LAN 접속).
- 배포 크기(앱): 모델 12.4MB + ort wasm 14.2MB + 코어 1.2MB ≈ 27MB (한 번 받으면 캐시).
- 발견한 버그: `ort.env.wasm.proxy=true`(워커 추론)는 입력 텐서 버퍼를 워커로 **이전(transfer)** 해서 원본 배열이 비게 됨 → 마스크가 0이 되어 Q가 0개로 나왔음. Node에는 proxy가 없어 테스트에서 안 드러났음. `mortal-web.js`에서 텐서에 복사본을 넘기도록 수정.
- 검증: 크롬 기반 앱 패널에서 저장소 자동 연결 → 모델 IndexedDB 캐시 로딩(약 1.0s) → 랜덤 문제 생성 → 클릭 시 Mortal 확률/Q 격차/채점 표시까지 동작. 동일 대국·지점 8개를 브라우저와 Node(같은 모델)로 계산해 마스크 불일치 0, 최대 |dq| 6e-6. 지점당 약 83ms(브라우저, 워커 통신 포함).

### 2026-10-11 Step 10: S4에 올린 저장소 검증 + 샤드 동기화
- 위치: `https://s3.g.megas4.com/<계정ID>/test1/store/` (manifest.json + shard-000~006.json.gz). 8개 파일 모두 로컬 `store-out/`과 **바이트 동일**, 685판 전부 gunzip OK, manifest의 n과 일치, 임의 Origin에 대해 ACAO 반사.
- 속도(암스테르담, RTT≈300ms): 샤드 1개(≈650KB) 2.6~3.3s, 연결당 처리량 ≈0.2~0.25MB/s(첫 바이트 ≈0.9s). 4개 병렬은 2.8s에 완료 → **병렬 연결로 처리량이 거의 선형 증가**.
- 대응: `provider.js`가 연결 직후 모든 샤드를 병렬 3개로 받아 IndexedDB에 저장(`shard:<manifest.version>:<file>`), 저장소 버전이 바뀌면 옛 캐시 자동 삭제. 캐시가 있으면 그 샤드 안에서만 문제를 뽑아 즉시 로딩, 오프라인 동작.
- 실측(앱 패널, 캐시 비운 뒤): 685판 전체 동기화 3.3s. 이후 문제 생성(모델 로딩 포함 첫 대국 분석) 1.5s.
- 앱 패널에서 S4 주소로 연결/동기화/문제 생성이 동작(앞서 패널에서 막혔던 것은 HTTP 캐시에 남은 CORS 응답 문제였고, `?t=`/`?v=` 쿼리로 캐시 키를 바꾸면 해결).

### 2026-10-11 Step 11: github.io 하위 경로 배포 준비
- 대상: 사용자 사이트 저장소 `joybnuuy.github.io`의 하위 폴더(기본 `mahjong` → `https://joybnuuy.github.io/mahjong/`).
- 하위 경로 호환 검증: `PREFIX=mahjong node tools/serve.mjs`(접두사 밖은 404)로 `/mahjong/` 아래에서 실행 → 모델 로딩·S4 연결·동기화·문제 생성·피드백 정상, 루트로 새는 요청 0건, 콘솔 오류 0건. (Git Bash는 `/mahjong`을 Windows 경로로 바꿔 넘기므로 슬래시 없이 `PREFIX=mahjong` 사용.)
- `tools/stage_pages.mjs`: `app/` → `<dest>/<subdir>/` 복사(커밋/푸시 안 함). 복사 전 점검: 로그 XML, S4 주소/계정 ID, 개인 식별 정보, 데이터 파일(.xml/.gz/.ai.json), 90MB 초과 파일이 있으면 중단. 가짜 로그/S4 주소를 넣어 차단 동작을 확인(정규식 버그 1건을 이 시험으로 발견·수정). `--clean`은 `<subdir>`만 비움.
- `tools/check_deploy.mjs <URL>`: 배포 후 MIME(.wasm=application/wasm, .mjs=javascript), 크기, 캐시/인코딩 헤더, 모델 크기 일치를 확인. 로컬 서버로 시험 통과.
- 링크로 저장소 주소 전달: `https://…/mahjong/#store=<인코딩된 주소>` → 설정 창에 채워서 열기만 하고 자동 저장은 하지 않음(사용자가 저장 버튼을 눌러야 함). 아이폰에서 긴 주소를 입력하지 않기 위함.
- 공개 범위: `app/`(28MB)만. `s4-test/`에는 S4 계정 ID가 들어 있으므로 공개 저장소에 넣지 말 것. AGPL 대응 소스는 별도 공개 저장소를 권장(SOURCE.md의 REPO_URL).
- 미해결: AGPL 소스 저장소 생성/주소 확정, github.io 실배포 후 `check_deploy` 실행, 아이폰(Safari) 실측.

### 2026-10-11 Step 12: V5 — 온라인 연결 + V4/V1 화면 선택
- 배경: 최신 화면은 `v4`(모바일 우선 테이블, 이론 해설, 위험패 찾기, 오답노트)였고 지금까지의 정적 앱은 V1(루트 `public/`) 기반이었음. V1=루트 public, V2=SVG 패+테이블, V3=이론 해설, V4=모바일 레이아웃.
- V5(`v5/`): V4 화면(루트)과 V1 화면(`v1/`)을 둘 다 담고, 설정 ⚙에서 선택(`?ui=v1|v4`도 가능). 공통 코어(`core/`): `boot.js`(화면 이동/설치), `provider.js`(저장소·분석·`/api/*` 가로채기), `notebook.js`(V4의 `/api/notebook`을 IndexedDB로 대체 + 내보내기/가져오기), `settings-ui.js`, `idb.js`.
- 설계: 각 화면의 `app.js`는 그대로 두고 `fetch('/api/…')`만 가로챔. 분석에 쓰는 `mjlog/mjai/points`는 *현재 페이지의* `js/`에서 동적 import → V1/V4 각자의 것을 사용(두 화면의 `points.js`는 동일함을 diff로 확인). 캐시 삭제는 `model:`/`shard:` 키만 지워 오답노트를 보존.
- V1의 패 표시: `tile()`을 글자 → `<img>`(V4와 같은 CC0 libreriichi SVG)로 교체, 이미지 경로는 모듈 URL 기준이라 하위 경로 배포에도 안전. 패 이미지 라이선스(CC0)는 `tiles/libre/LICENSE-CC0.txt` 동봉 확인.
- 브라우저(앱 패널, `/mahjong/` 접두사 서버) 검증: 첫 방문 안내 → S4 연결(685판) → V4 문제(패 이미지 78개)·채점·오답노트 저장 → 설정에서 V1 전환(패 이미지 35개, 옛 글자 패 0) → `?ui=v4`로 복귀, 오답노트 탭에서 기록 확인. 375px(폰 폭)에서 두 화면 모두 가로 스크롤 없음, ⚙ 버튼 표시. 오답노트 가져오기는 같은 기록 재가져오기 시 중복 없이 병합, 잘못된 형식은 거부.
- 발견/수정한 문제: (1) V4 헤더에서 탭이 폭을 다 써서 ⚙가 화면 밖으로 밀림 → 좁은 폭에서 탭 여백 축소. (2) V1 헤더에서 ⚙가 부제와 겹침 → 제목 오른쪽 여백. (3) 개발 서버에 `.svg` MIME과 디렉터리 `index.html` 처리가 없었음(GitHub Pages는 문제없음).
- 도구: `v5/tools/build.mjs`(→ `v5/dist`), `stage_pages.mjs`/`export_source.mjs`는 V5 구조로 갱신, 이전 `web-mortal/app`·`build_app.mjs`는 제거(소스 저장소에는 이전 푸시본이 남아 있으므로 다음 푸시 때 정리 필요).

### 2026-10-11 Step 13: V5 정정 — V1은 "화면 구성만" V1, 시스템은 V4 그대로
- 정정: Step 12 의 V1 구현(루트 `public/`의 V1 로직 사본 + 패 이미지)은 요구와 달랐음. 요구는 **시스템(문제 생성·4모드·이론 해설·위험패 찾기·오답노트)은 V4 그대로, 화면 구성만 V1식**. V1 로직 사본(`v5/public/v1/js/*`)은 삭제.
- 새 구조: `v5/public/v1/` = `index.html` + `skin.css` + `js/table-v1.js` 뿐.
  - `index.html`: V4 와 같은 DOM id 구조(#top/#tabs/#statline/#stage/#strip/#board/#panel/#prompt/#handwrap/#controls/#result/#feedback/#actions/footer)를 유지 + `<base href="../">`로 V4 의 `js/`, `style.css`, `tiles/`, `core/`를 그대로 공유.
  - import map `{"./js/table.js": "./v1/js/table-v1.js"}`: V4 `app.js`가 import 하는 `table.js`만 V1식 보드로 교체. 인터페이스(`renderTable(q,opts) → {el, revealed, markPick, reveal}`, `renderHandBar`)가 같아서 `app.js`는 무수정. 원본 `renderHandBar`는 `table.js?orig`(import map 키와 다른 URL)로 재사용.
  - `skin.css`: `html[data-ui="v1"]` 아래에서만 V4 의 100dvh 레이아웃을 풀고(흐름형 카드), V1 헤더/팔레트, 좌석별 행 보드, 정답 공개 시 손패 행을 표시.
- 검증(앱 패널, `/mahjong/` 접두사 서버): V1 화면에서 타패 효율(해설·채점·오답노트 저장), 리치 방어(리치 배지, 정답 후 상대 손패 13장 공개, 방총률 근거), 텐파이 감(3/3 판정, 3명 손패 36장 공개, 관찰 단서), 위험패 찾기(론 판정), 오답노트 탭(모드별 개수 집계, 섞어서 다시 풀기)이 모두 V4 시스템 그대로 동작. 375px 에서 가로 스크롤 없음. `?ui=v4`/설정 라디오로 두 화면 왕복 이동, 오답노트 유지.
- 발견/수정: S4 는 `Vary: Origin` 이 없어 **같은 브라우저에서 두 출처(localhost 와 github.io)가 같은 URL 을 받으면** 이전 출처의 CORS 헤더가 캐시에서 재사용되어 차단됨 → 매니페스트/샤드 URL 쿼리에 출처 해시(`&o=`)를 넣어 캐시 키를 출처별로 분리. 또 샤드 하나가 실패해도 다른 샤드로 넘어가도록 `randomGame`을 수정.

### 2026-10-11 Step 14: 대칭 구조로 정리 — `/mahjong/` 런처 + `v4/` + `v1/`
- 문제: V4가 사이트 루트에, V1만 하위 폴더에 있어 비대칭. 요청에 따라 두 화면을 같은 깊이의 하위 폴더로 두고 루트는 기본 화면으로 보내는 런처로 변경.
- 구조: `/mahjong/`(런처) → `/mahjong/v4/`(V4 시스템 일체: js/, style.css, tiles/) 또는 `/mahjong/v1/`(index.html + skin.css + js/table-v1.js). 공통 `core/`, `vendor/`, `model/`은 루트에 유지. V1은 "V4 시스템 + V1 스킨"이므로 `<base href="../v4/">`로 `v4/`의 js·style·tiles를 공유하고, import map `{"./js/table.js": "../v1/js/table-v1.js"}`로 보드 렌더러만 교체.
- 런처(`index.html`): 설정(`mjp-store-v1.ui`)에 저장된 화면, 없으면 V4(최신). `?ui=v1|v4`가 있으면 그것을 우선. 검색어·해시(`#store=…`)는 그대로 전달. JS 불가 시 `<noscript>` refresh + 링크.
- 코드 변경: `boot.js`/`settings-ui.js`의 이동 대상을 사이트 루트(`new URL('../', import.meta.url)`) 기준으로 계산, V4 페이지의 core 경로를 `../core/…`, `table-v1.js`의 import를 `../../v4/js/…`로. `check_deploy.mjs` 검사 목록, NOTICE/README 경로(`v4/tiles/libre/…`) 갱신.
- 검증(앱 패널): 저장값 v1 → `/mahjong/`가 `/mahjong/v1/`로, `?ui=v4#store=…` 는 `/mahjong/v4/`로 가서 설정 저장·주소 정리·설정 창에 저장소 주소 채움(자동 저장 안 함). V4/V1 모두 문제 생성·채점·오답노트 저장(두 화면이 같은 기록 공유), V1에서 `base`가 `/mahjong/v4/`, 패 이미지·워커가 `v4/`에서 로드됨. 로컬 `check_deploy`로 새 구조의 25개 파일 MIME/크기 통과.

### 2026-10-11 Step 15: 메인 메뉴(설정 화면)와 준비 가드
- 요구: `/mahjong/`를 메인 메뉴로 하고, 엔진·데이터 저장소가 준비되지 않았으면 `/v1/`, `/v4/`로 와도 메뉴로 보내 설정하게 하며, 설정 후에는 `/mahjong/`가 알아서 저장된 화면으로 보내기.
- 결정: 서브디렉토리 유지. 앱 한 페이지에서 스킨만 런타임 교체하는 단일 페이지안은 가능하지만 V4의 `table.js`를 고쳐 분기하거나 import map 을 동적으로 끼워야 하고(검증된 V4 코드를 건드림, Safari 동작 미확인) `/v1/`·`/v4/` 딥링크가 사라지는 반면 얻는 이득은 HTML 하나 줄이는 정도.
- 구현: `index.html`+`core/menu.js`+`core/menu.css`(메인 메뉴), `core/boot.js`(가드), `core/provider.js`(`engineVersion` 기록, `fetchModelInfo`, 다운로드 진행률, `install({gate})`).
  - 준비 판정: `engineVersion`(엔진이 실제로 시작된 버전) && (`storeBase` || `filesOnly`). IndexedDB 유무로 판정하지 않음(사생활 보호 모드에서 무한 반복 방지).
  - 화면 쪽 가드는 첫 `/api` 요청을 게이트로 보류한 채 `model.json` 버전을 확인(2.5초 제한, 실패 시 진행). 새 모델이면 메뉴로 → 이전 설정자는 자동 재준비 후 원래 화면으로 복귀.
  - 처음 사용자는 버튼을 눌러야 엔진(약 30MB)을 받음(모바일 데이터 보호). 이전 설정자의 재준비는 자동.
  - ⚙ 설정 창: 첫 방문 안내 제거, "메인 메뉴" 링크 추가. 캐시 지우기는 `engineVersion`도 지워 다음에 메뉴에서 재준비. 파일 모드는 로그 가져오기 안내 + 가져온 직후 자동 시작.
- 검증(앱 패널): 첫 방문에서 `/v4/` → `/?from=v4`(시작 버튼 잠김) → 링크로 주소 채움(자동 저장 없음) → 엔진 준비(기록) → 저장소 연결 → V4 시작(문제 0.4s). 이후 `/` → 자동으로 `/v4/`, `/?menu=1` 은 메뉴 유지(①② ✓, 마지막 화면 강조). 엔진 버전을 낡게 바꾸고 `/v1/` → `/?from=v1`(자동 재준비) → `/v1/` 자동 복귀. 저장소 해제 상태에서 `/v4/` → 메뉴 → "파일만 쓰기" → 화면 열림(안내창), 파일 가져오기 → 2.8s 만에 문제.

### 2026-10-11 Step 16: 메뉴에서 설정 도중 화면으로 튕기는 문제 수정
- 증상(사용자 보고): 메인 메뉴에서 설정을 다 마치기 전에 V4/V1 인터페이스를 설정하면 해당 서브디렉토리로 이동해 버림.
- 원인: 이동이 일어나는 경로가 세 개였음. (1) 평소 `/mahjong/`는 ①엔진·②저장소만 ✓이면 화면을 고른 적이 없어도 자동 이동, (2) 화면에서 돌려보내진 뒤 엔진 재준비가 끝나면 "저장소 주소만 입력한 사람"도 자동 복귀, (3) V4/V1 버튼이 "고르기"와 "이동"을 한 동작으로 묶음.
- 수정: ③ 화면 선택은 `ui`만 저장(이동 없음), 이동은 별도의 "시작하기"로만. 자동 이동·자동 복귀는 `setupDone`(시작하기를 누르거나 화면이 정상적으로 열린 적이 있음)일 때만. 엔진 자동 재준비도 동의한 적이 있을 때(`setupDone` 또는 `engineVersion`)만(저장소 주소만 입력해 둔 정도로는 30MB 자동 다운로드를 하지 않음). `boot.js`는 화면을 고른 적이 없으면 직접 연 페이지를 그대로 쓰고 그 선택을 기록.
- 검증(앱 패널): 첫 방문에서 화면 카드(V1) 클릭 → 이동 없이 선택만 저장, 잠긴 시작 버튼 강제 클릭 무반응, 저장소만 끝낸 상태에서도 이동 없음. ①②를 모두 끝내고 시작하기 활성화 상태에서 `/mahjong/` 재방문 → 메뉴 유지(setupDone 없음). 시작하기 클릭 → 이동 + setupDone 기록 → 이후 `/mahjong/` → 선택한 화면으로 자동 이동, `?menu=1` → 메뉴 유지. 저장소 주소만 있는 상태로 `/?from=v4` → 엔진 자동 다운로드 없이 메뉴 유지(시작 잠김).

### 2026-10-11 Step 17: 엔진 여러 개 + 엔진별 삭제 (엔진 레지스트리)
- 요구: 설정·캐시 지우기는 있는데 엔진을 지우는 기능이 없음. 파인튜닝한 엔진이 늘어날 수 있으니 엔진이 하나가 아닌 구조로.
- 구조: 원본 `v5/engines.json`(id/name/kind/description/source/license/base/changes) → 빌드가 `model/<id>/mortal.onnx` 와 `model/engines.json`(format 1, default, 엔진별 file/version/sha256/bytes)을 생성. 버전 = sha256 앞 12자. 엔진 추가 = 항목 추가 + `node v5/tools/build.mjs`. 입출력 규약(obs 1012×34 + mask 46 → q 46)만 같으면 된다.
- 클라이언트: IndexedDB 키 `model:<id>:<version>`, 설정 `engines:{id:version}`·`engineId`·`removedEngines`. 메뉴의 엔진 목록에서 엔진별 받기/업데이트/삭제, 클릭은 선택만(이동·다운로드 없음). ⚙ 설정에서도 선택·삭제. 분석 결과(`ai.engine`)에 엔진 id 를 기록하고, 캐시된 해설은 현재 엔진과 같을 때만 재사용. 지운 엔진의 오래된 캐시·고아 캐시는 정리. 오답노트·로그 캐시는 엔진 삭제와 무관.
- 지운 엔진 정책: 사용자가 지운 엔진(`removedEngines`)은 자동으로 다시 받지 않음(새 버전 배포로 낡아진 경우만 자동). 화면에서 엔진이 없으면 메뉴로 보내 안내만 하고, 직접 누른 "받기"는 메뉴에 머무름(자동 복귀는 자동 재준비일 때만).
- 확인창(`confirm()`)이 브라우저에서 막혀 삭제 버튼이 먹통처럼 보인다는 보고 → 같은 버튼을 4초 안에 두 번 누르는 방식으로 교체(메뉴·설정 창 전부).
- 검증(앱 패널): 두 엔진(q8 + 임시 fp16) 설치/선택/삭제, 선택 엔진으로 분석(`ai.engine` 확인), 한 엔진 삭제가 다른 엔진·로그에 영향 없음, 전부 삭제 후 되살아나지 않음, 받기 후 메뉴에 머무름, 두 번 누르기 삭제. 공식 배포는 q8 하나.
