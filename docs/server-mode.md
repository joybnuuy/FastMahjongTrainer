# 속성 마작 연습

텐호우 봉황방(4인) 실제 대국 로그에서 한 장면씩 뽑아 푸는 리치마작 퀴즈.

```
npm start      # http://localhost:3000  (Node 18+, 의존성 없음)
npm test       # 엔진/로그 시뮬레이터 스모크 테스트 (cache/ 로그로 화료 패 검증 포함)
```

## Mortal AI (ai/)
①②는 [Mortal-S42](https://huggingface.co/haor/Mortal-S42) (Mortal v4, 가중치 Apache-2.0 / 런타임 AGPL-3.0)의 판단으로 채점합니다.
`ai/`가 없거나 미설치면 자동으로 기존 효율 엔진으로 폴백합니다.

```
ai/Mortal-S42/        # git clone https://huggingface.co/haor/Mortal-S42  (가중치 41.9MiB 포함)
ai/.venv/             # uv venv --python 3.12 + torch (cu128; RTX 50 시리즈는 cu128 이상 필요)
ai/Mortal-S42/runtime/mortal/libriichi.pyd   # Rust 런타임 빌드 결과
```
- 빌드(Windows, MSVC 없이): `runtime/Cargo.toml`에서 저장소에 없는 `exe-wrapper` 멤버를 제거했고, `cargo +stable-x86_64-pc-windows-gnu build --release -p libriichi`(MinGW gcc 필요, `PYO3_PYTHON`=ai/.venv의 python.exe)로 만든 `riichi.dll`을 `libriichi.pyd`로 복사. 스모크 테스트: `ai/.venv/Scripts/python ai/Mortal-S42/inference.py --smoke --device cuda`
- 흐름: 텐호우 로그 → `public/js/mjai.js`(mjai 변환) → `ai/analyze.py`(상주 워커, 상대 패 마스킹 후 Bot에 입력) → Q값 → 서버가 `cache/<id>.ai.json`에 저장 → 브라우저에서 softmax(T=1)로 확률화.
- 검증: `node test/ai-agreement.js 3` — Mortal 1순위와 실제 봉황방 플레이어 타패의 일치율 78% (1,483판단).
- 채점: Q 격차 0.1 이내 ◎, 0.7 이내 ○, 그 외 ×. Q값은 승률이 아니라 상대적 행동 점수입니다.

## 퀴즈
1. **타패 효율** — 손패/강/도라만 보고 버릴 패 선택. Mortal의 선택 확률로 채점(리치/다마 합산), 샨텐·우케이레는 참고 표시. (AI 없을 때: 샨텐 → 우케이레 → 한 수 앞 잠재력)
2. **리치 방어** — 상대가 리치했고 내 손에 *실제로* 론 당하는 패가 있는 장면(로그라 상대 패가 보임). Mortal이 밀기/접기까지 포함해 채점하고, 휴리스틱 방총률(현물/스지/벽/자패/도라)과 실제 대기를 해설에 공개.
3. **텐파이 감** — 타패 직후 스냅샷에서 리치 안 한 상대 3명의 텐파이 여부 맞히기. 정답은 실제 손패로 계산.

## 구조
- `server.js` — 정적 서빙 + `/api/game[?id=]` (tenhou.net 로그 프록시, `cache/`에 저장)
- `public/js/mjlog.js` — mjlog XML 파서, 치/퐁/칸 디코딩, 국 단위 시뮬레이터
- `public/js/engine.js` — 샨텐(일반/치또이/국사), 우케이레, 타패 평가
- `public/js/danger.js` — 방총 위험도 휴리스틱
- `public/js/gen.js` — 로그 → 문제 생성 (`worker.js`에서 실행)

## 한계
- Mortal은 모든 판단 지점이 아니라 선택된 지점(판당 최대 22개)만 평가합니다. 첫 요청은 모델 로딩 때문에 몇 초 더 걸립니다.
- 방총률 열은 경험칙 휴리스틱(`danger.js` 상수)이며 Mortal의 판단과는 별개입니다.
- ③ 텐파이 퀴즈는 AI 없이 실제 손패로 채점합니다.
