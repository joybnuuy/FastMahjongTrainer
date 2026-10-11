# FastMahjongTrainer (속성 마작 연습)

실제 천봉(Tenhou) 봉황방 대국에서 한 장면씩 뽑아 푸는 리치 마작 연습 앱입니다.
[Mortal](https://github.com/Equim-chan/Mortal) AI의 Q값으로 채점합니다.

1. **타패 효율** — 손패/강패를 보고 버릴 패 고르기. Mortal은 선택 확률로 채점(◎ 최선, ○ 허용), 샨텐·우케이레는 참고로 표시
2. **리치 방어** — 상대가 리치했고 내 손에 *실제로* 론 가능한 패가 있는 장면. 안전도 휴리스틱과 실제 대기 해설
3. **텐파이 감** — 대국 직후 스냅샷에서 상대 3명의 텐파이 여부 맞히기

## 두 가지 실행 방식

| | 서버 모드 | 정적 모드 (브라우저 안 Mortal) |
|---|---|---|
| 위치 | `server.js` + `public/` + `ai/` | `web-mortal/` → `app/` |
| Mortal 실행 | Python + PyTorch(GPU/CPU) | WebAssembly 인코더 + onnxruntime-web (int8 가중치 모델, 약 12MB) |
| 로그 | 서버가 천봉에서 받아 `cache/`에 저장 | 사용자가 지정한 **데이터 저장소 URL**(또는 로컬 파일)에서 브라우저가 직접 받음 |
| 호스팅 | 로컬 Node 서버 | 정적 호스팅(GitHub Pages 등) |

정적 모드의 앱은 대국 로그를 **포함하지 않습니다**. 설정(⚙)에서 `manifest.json`과 샤드(`shard-NNN.json.gz`)가 있는 폴더 주소를 넣으면
브라우저가 CORS로 직접 받아 IndexedDB에 캐시하고, 분석은 전부 기기 안에서 합니다. 서버가 필요 없습니다.

## 빠른 시작

### 서버 모드
```bash
npm start      # http://localhost:3000  (Node 18+)
npm test       # 엔진/로그 시뮬레이션 스모크 테스트
```
Mortal 설치(선택)와 사용법은 [docs/server-mode.md](docs/server-mode.md) 참고. 없으면 효율 엔진으로 동작합니다.

### 정적 모드 빌드
필요한 것: Node 18+, Rust + `wasm32-unknown-unknown` 타깃 + `wasm-bindgen-cli`(0.2.129), Python 3.12(torch, onnx, onnxruntime),
그리고 Mortal-S42 배포본(`git clone https://huggingface.co/haor/Mortal-S42 ai/Mortal-S42`).
전체 파이프라인(wasm 코어 → ONNX 내보내기 → 양자화/QAT → 앱 조립 → 배포)은 [web-mortal/README.md](web-mortal/README.md)에 있습니다.

## 구조
- `server.js`, `public/`, `test/`, `ai/analyze.py`, `ai/client.js` — 서버 모드 (원본 앱)
- `web-mortal/wasm-core/` — libriichi(Mortal 런타임)에서 상태 추적·관측 인코딩만 떼어 낸 wasm용 crate
- `web-mortal/*.py` — ONNX 내보내기, 민감도 분석, 양자화, QAT(증류) 등 모델 변환 스크립트
- `web-mortal/app/` — 정적 앱의 직접 작성한 부분 (`provider.js`, `settings-ui.js`, `index.html`)
- `web-mortal/tools/` — 앱 조립, 데이터 저장소 샤드 생성, 배포 폴더 준비/점검, 개발 서버
- `web-mortal/RESEARCH.md` — 실험 기록(양자화 결과, 측정값, 시행착오)

## 라이선스
- 이 저장소의 코드: **GNU AGPL-3.0-or-later** ([LICENSE](LICENSE)). `wasm-core/`는 Mortal의 `libriichi`(AGPL-3.0-or-later)에서 파생되었습니다.
- Mortal 모델 가중치(Mortal-S42): **Apache-2.0**. 이 프로젝트의 배포 모델은 양자화·미세조정한 **수정본**입니다 ([NOTICE.md](NOTICE.md)).
- onnxruntime-web: MIT.
- 대국 로그는 이 저장소에 포함되어 있지 않습니다. 로그의 수집·보관·재배포는 해당 서비스의 이용약관을 확인하고 본인 책임으로 하세요.

배포된 정적 앱의 대응 소스는 이 저장소입니다.
