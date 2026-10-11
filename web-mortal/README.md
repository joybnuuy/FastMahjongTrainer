# web-mortal — 브라우저에서 Mortal 돌리기

Mortal-S42(Mortal v4)를 서버 없이 브라우저/아이폰에서 돌리기 위한 변환·검증·배포 도구 모음입니다.
측정값과 시행착오는 [RESEARCH.md](RESEARCH.md)에 있습니다.

## 구성 요소
1. **wasm 코어** (`wasm-core/`): libriichi의 상태 추적 + 관측(1012×34) 인코딩 + 합법 행동 마스크. `derive_core.py`가 upstream에서 필요한 부분만 복사하고 PyO3/numpy 바인딩을 제거합니다.
2. **ONNX 모델**: `Brain`+`DQN`을 하나로 묶어 `obs(N,1012,34)`, `mask(N,46)` → `q(N,46)`. 불가능 행동은 `-inf`.
3. **양자화**: 가중치만 int8(채널별) + 나머지 fp16 저장, 활성은 fp32 계산(활성 양자화가 오차의 대부분이라서). 원본 모델을 교사로 한 증류 QAT로 오차를 추가로 줄입니다.
4. **정적 앱** (`../v5/`): V4·V1 화면을 수정 없이 쓰고, `fetch('/api/…')`만 `v5/public/core/provider.js`가 가로챕니다. 자세한 구조는 [../v5/README.md](../v5/README.md).

## 파이프라인 (저장소 루트에서)
```bash
# 0) 준비: ai/Mortal-S42 (HF haor/Mortal-S42), ai/.venv (Python 3.12 + torch + onnx + onnxruntime + onnxscript), npm i --prefix web-mortal
# 1) wasm 코어
python web-mortal/derive_core.py
cd web-mortal/wasm-core
cargo build --release --target wasm32-unknown-unknown          # MSVC 없는 Windows: cargo +stable-x86_64-pc-windows-gnu …
wasm-bindgen --target web --out-dir ../pkg target/wasm32-unknown-unknown/release/mortal_wasm_core.wasm
cd ../..
# 2) ONNX + 정확도 검증
python web-mortal/export_onnx.py
node web-mortal/test_wasm_node.mjs
# 3) 평가/학습 데이터 (본인이 가진 천봉 로그를 cache/ 에 둔 경우)
node web-mortal/gen_dataset.mjs            # calib/eval
node web-mortal/gen_dataset.mjs train 100  # train (calib/eval 대국 제외)
# 4) 양자화 실험 → 가중치 전용 int8 + QAT
python web-mortal/quantize.py              # fp16 / int8 변형 비교
python web-mortal/sensitivity.py           # 레이어별 민감도
python web-mortal/weight_only.py           # 가중치 전용 int8
python web-mortal/qat.py --weight-only --keep 4 --steps 2000 --lr 1e-6 --tag qat-wo-lr1e-6
# 5) 앱 조립 + 데이터 저장소 샤드
node v5/tools/build.mjs                                 # → v5/dist (REPO_URL 환경변수로 SOURCE.md 의 소스 주소 지정)
node web-mortal/tools/build_shards.mjs --per 100       # → store-out/ (대국 로그 포함! 공개 저장소에 올리지 말 것)
# 6) 개발 서버 / 배포 폴더 / 점검
PREFIX=mahjong node web-mortal/tools/serve.mjs         # 앱 http://127.0.0.1:8770/mahjong/, 저장소 http://127.0.0.1:8771/
node web-mortal/tools/stage_pages.mjs --dest <pages 저장소> --subdir mahjong --clean
node web-mortal/tools/check_deploy.mjs https://<사용자>.github.io/mahjong/
```

## 알아 둘 점
- Git Bash는 `/foo` 형태의 환경변수/인자를 Windows 경로로 바꿉니다. `PREFIX=mahjong`처럼 슬래시 없이 쓰세요.
- 천봉 로그 수집·재배포는 해당 서비스 약관을 확인하세요. `stage_pages.mjs`는 로그/주소/개인정보가 `v5/dist`에 섞이면 중단합니다 (점검 대상: `v5/dist`).
- 모델 가중치는 이 저장소에 없습니다. 원본은 HF `haor/Mortal-S42`(Apache-2.0)에서 받아 위 순서로 변환합니다.
