# 라이선스 고지 (NOTICE)

## 이 저장소
GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). 전문: [LICENSE](LICENSE).

## Mortal 런타임 (libriichi)
- 원저작: Equim-chan, <https://github.com/Equim-chan/Mortal>, AGPL-3.0-or-later (upstream commit `0cff2b52982be5b1163aa9a62fb01f03ce91e0d2`, Mortal-S42 배포본의 `runtime/`).
- `web-mortal/wasm-core/`는 위 소스 중 상태 추적/관측 인코딩 부분만 추출한 **수정본**입니다.
  변경: Python 바인딩(PyO3/numpy), 멀티스레드·파일 입출력 관련 의존성 제거, wasm-bindgen 인터페이스(`src/wasm.rs`) 추가.
  변환은 `web-mortal/derive_core.py`가 재현합니다.

## Mortal 모델 가중치
- 원본: Mortal-S42 (체크포인트 S42.8k), Hugging Face `haor/Mortal-S42`, Apache-2.0 — <https://www.apache.org/licenses/LICENSE-2.0>.
- 이 프로젝트에서 배포하는 `model/mortal.onnx`는 **수정본**입니다 (Apache-2.0 §4(b)): ONNX 변환, 합성곱 가중치의 int8(채널별) 양자화,
  나머지 fp16 저장, 원본을 교사로 한 증류 미세조정(QAT). 미세조정 입력은 공개 대국 로그에서 만든 관측 텐서이며 로그 자체는 포함하지 않습니다.
- 모델 가중치 파일은 이 소스 저장소에 포함되어 있지 않습니다 (배포 산출물에만 있음).

## 패 이미지
`v5/public/v4/tiles/libre/*.svg` — libreriichi-assets (<https://codeberg.org/davidgomez/libreriichi-assets>), CC0 1.0. 라이선스 사본은 `v4/tiles/libre/LICENSE-CC0.txt`.

## onnxruntime-web
MIT License, Microsoft. 배포 산출물의 `vendor/ort/`.

## 데이터
이 저장소에는 대국 로그가 포함되어 있지 않습니다.
