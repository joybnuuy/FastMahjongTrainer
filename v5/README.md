# 속성 마작 연습 V5 — 온라인 연결 (브라우저 안 Mortal) + 화면 선택

V4(`../v4`)의 화면과 로직은 그대로 두고, **서버 없이 정적 호스팅**으로 돌아가게 만든 버전입니다.
Mortal 분석은 브라우저 안(WebAssembly + onnxruntime-web)에서 하고, 대국 로그는 **사용자가 설정에 넣은 데이터 저장소 URL**에서 받습니다.
`../ai`, `../cache`는 쓰지 않습니다 (로그는 저장소/파일에서, 분석은 기기에서).

## 화면 두 가지 (설정 ⚙ 에서 선택)
**시스템은 둘 다 V4 그대로**입니다 (문제 생성, 4가지 모드, 이론 해설, 위험패 찾기, 오답노트, 채점). 다른 것은 **화면 구성**뿐입니다.

| | 화면 구성 |
|---|---|
| **V4** | 모바일 우선. 실제 마작 테이블 배치(4좌석 회전, 6장×3줄 버림패), 문제 화면이 뷰포트를 가득 채우고 해설은 아래로 이어짐 |
| **V1** | 목록형. 정보줄 + 좌석별 행(이름·점수·버림패·후로)의 보드, 위에서 아래로 흐르는 카드 구성. 패는 V4와 같은 이미지(CC0) |

선택은 이 브라우저에 저장되고, 주소 끝에 `?ui=v1` / `?ui=v4`를 붙여도 바뀝니다. 두 화면은 같은 설정·저장소·오답노트를 공유합니다.

## 구조
```
v5/
  public/                 손으로 관리하는 소스 (사이트 루트가 됨)
    index.html            메인 메뉴(= 설정 화면): ① 엔진 준비 ② 데이터 저장소 ③ 화면 선택 → 시작하기. 시작한 적이 있고 모두 준비돼 있으면 메뉴 없이 저장된 화면으로 이동
    v4/                   V4 화면 = V4 시스템 일체 (v4/public 복사): index.html, js/, style.css, tiles/
    v1/                   V1 화면 = V4 시스템 + 스킨: index.html, skin.css, js/table-v1.js 뿐 (v4/ 의 js·style·tiles 를 공유)
    core/                 V5 공통
      boot.js             V1/V4 공통 시작: 준비가 안 됐으면 메뉴로 돌려보냄, 설정의 화면과 다르면 이동, 새 모델이 배포되면 메뉴에서 재준비
      menu.js, menu.css   메인 메뉴의 동작과 스타일
      provider.js         /api/game 대체: 저장소(manifest+샤드) 또는 로컬 파일 → 브라우저 안 Mortal 분석
      notebook.js         /api/notebook 대체: IndexedDB 저장 (+ 내보내기/가져오기)
      settings-ui.js      ⚙ 설정 창 (화면 선택, 저장소 URL, 로그 가져오기, 오답노트, 모델 캐시)
      idb.js, core.css
  tools/build.mjs         v5/public + wasm 코어 + onnxruntime + 모델 + 라이선스 문서 → v5/dist
  dist/                   배포물 (생성됨, git 제외)
```
## 주소와 준비 흐름
| 주소 | 동작 |
|---|---|
| `/mahjong/` | **메인 메뉴**: ① 엔진 준비 → ② 데이터 저장소 → ③ 화면 선택 → **시작하기**. 화면 선택은 저장만 하고 이동하지 않으며, 이동은 "시작하기"로만 일어남. 한 번이라도 시작했고 모두 준비돼 있으면 메뉴 없이 저장된 화면(V4/V1)으로 이동. `?menu=1`이면 항상 메뉴를 보여 줌 |
| `/mahjong/v4/`, `/mahjong/v1/` | 준비가 안 됐으면 `/mahjong/?from=v4`로 돌려보냄(`#store=…` 해시는 유지). 설정의 화면과 다르면 그 화면으로 이동 |
| 새 모델 배포 후 | 저장된 엔진 버전이 `model/model.json`의 버전과 다르면 메뉴로 보내 진행률과 함께 재준비한 뒤 원래 화면으로 자동 복귀 |

"준비됨" = 이 브라우저에서 엔진이 실제로 시작된 기록(`engineVersion`)이 있고, 저장소 주소가 있거나(`storeBase`) 파일 모드를 골랐을 것(`filesOnly`). "시작함"(`setupDone`) = 메뉴에서 시작하기를 눌렀거나 화면이 정상적으로 열린 적이 있음. 자동 이동은 시작함 && 준비됨일 때만 한다. 모두 `localStorage`의 `mjp-store-v1`에 있습니다.
저장소 없이 로그 파일만 쓰는 사람은 화면 안 ⚙ 설정에서 파일을 가져오면 바로 문제가 시작됩니다.
- UI 코드(`app.js` 등)는 수정하지 않고 `fetch('/api/…')`만 가로챕니다.
- **V1 화면은 V4의 JS를 그대로 씁니다.** `v1/index.html`이 `<base href="../v4/">`로 `v4/`의 파일들을 가리키고, import map으로 `table.js`(보드 그리기)만 `v1/js/table-v1.js`로 바꿔 끼웁니다. 두 모듈은 같은 인터페이스(`renderTable`, `renderHandBar`)라서 `app.js`는 한 줄도 바뀌지 않습니다. (import map 미지원 구형 브라우저에서는 V4 테이블이 보일 뿐 동작은 같습니다.)
- 모든 URL이 상대 경로라서 `https://<사용자>.github.io/<폴더>/` 같은 하위 경로 배포에서도 동작합니다.

## 실행
```bash
node v5/tools/build.mjs                    # → v5/dist  (먼저 web-mortal 의 wasm 코어/모델이 준비되어 있어야 함: web-mortal/README.md)
PREFIX=mahjong node web-mortal/tools/serve.mjs   # 앱 http://127.0.0.1:8770/mahjong/ , 저장소(CORS) http://127.0.0.1:8771/
```
데이터 저장소는 `node web-mortal/tools/build_shards.mjs`로 만들고(로그가 들어 있으니 공개 저장소에 올리지 마세요), 설정 ⚙ 에 주소를 넣습니다.
링크로 전달하려면 `…/#store=<인코딩된 주소>` — 설정 창에 채워서 열 뿐 자동 저장하지는 않습니다.

## 서버 버전과 다른 점
- 천봉에서 로그를 직접 받지 못합니다 (CORS). 로그는 저장소/파일로만 들어옵니다.
- 오답노트는 서버의 `data/notebook.json`이 아니라 **브라우저 IndexedDB**에 저장됩니다 (설정에서 내보내기/가져오기).
- 정답 분석은 기기 안에서 계산하므로 첫 문제까지 모델 다운로드(약 12MB)가 필요하고, 이후엔 캐시됩니다.
- 모델은 가중치 int8 + 증류 미세조정판입니다 (Mortal 원본 대비 Q 격차 평균 오차 0.0034, 자세한 수치는 `../web-mortal/RESEARCH.md`).

## 라이선스
AGPL-3.0-or-later. 모델 가중치 Apache-2.0(수정본), 패 이미지 CC0, onnxruntime-web MIT. 자세한 내용은 배포물의 `NOTICE.md`.

## 엔진(모델) 추가·관리
- 배포할 엔진은 `v5/engines.json` 에 적는다 (`id` 소문자/숫자/하이픈, `source` 는 .onnx 경로, `license`, `base`, `changes`). 입출력은 obs `1012×34` + mask `46` → q `46` 이어야 한다.
- `node v5/tools/build.mjs` 가 `dist/model/<id>/mortal.onnx` 와 `dist/model/engines.json`(버전=sha256 앞 12자)을 만들고 NOTICE 에 엔진별 출처·변경 사실을 적는다. `default` 는 처음 선택되는 엔진.
- 사용자는 메인 메뉴에서 엔진별로 받기·업데이트·삭제, 선택을 한다. 직접 지운 엔진은 자동으로 다시 받지 않는다. 오답노트는 엔진과 무관하게 남는다.
- 파인튜닝한 엔진을 추가하려면: 새 .onnx 를 만들고 항목을 추가한 뒤 빌드 → `stage_pages.mjs` → `check_deploy.mjs` 로 크기·버전을 확인.

## 대국 데이터 출처
1. **천봉 직접 받기 (기본)**: `data/*.json` 의 패보 ID 목록(현재 천봉명인전 `meijin.json`)으로, 사용자 브라우저가 `https://tenhou.net/0/log/?<ID>` 에서 한 판씩 받아 IndexedDB 에 캐시한다. 앱에는 패보 본문이 없다. 요청은 순차·간격 1.5초·재요청 없음. ID 목록 갱신: `node web-mortal/tools/collect_meijin.mjs` (대회 페이지 요청은 3초 간격, HTML 은 `web-mortal/ids-cache/` 에 캐시).
2. **데이터 저장소**: 사용자가 직접 만든 manifest+샤드 (세미 오프라인용). 천봉 패보는 재배포 금지이므로 본인 전용으로만.
3. **로그 파일 가져오기**.

## 스타일 참고 (엔진에 붙는 선택 기능)
- 엔진 항목에 `styles` 경로(`styles.json` + `styles.bin`)를 적으면 빌드가 `model/<id>/` 로 복사하고 레지스트리에 넣는다 (엔진 버전은 모델+스타일 해시). 엔진 ONNX 는 몸체 특징 `phi` 를 추가 출력으로 가져야 한다 (`web-mortal/tools/add_phi_output.py`).
- 브라우저는 스타일 헤드가 있으면 같은 판단 지점에서 스타일별 Q 를 함께 계산해 분석 결과에 `styles` 로 싣고, 해설에 "스타일 참고"(스타일별 추천 패, 내 선택의 순위/격차)를 보여 준다. **채점에는 쓰지 않는다.** 스타일 파일을 못 받으면 스타일 없이 동작한다.
- 스타일 헤드는 천봉명인전·천봉위 대국으로 학습한 작은 보정 행렬이며 대국 데이터와 선수 이름은 들어 있지 않다 (자세한 방법/검증: `web-mortal/RESEARCH.md` Step 20~21).
