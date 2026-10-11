// 설정 창 (V1/V4 화면 공통): ⚙ 버튼과 대화상자를 JS로 만들어 현재 페이지 헤더에 붙인다.
import {
  settings, state, onState, connectStore, disconnectStore, importFiles, ensureEngine, getRegistry, pickEngineId, installedEngines, isInstalled,
  useEngine, deleteEngine, clearLogCache, loadTenhouList,
} from './provider.js';
import { exportNotebook, importNotebook, notebookCount } from './notebook.js';

const ROOT = new URL('../', import.meta.url).href;      // 사이트 루트 (NOTICE.md 등 링크용)
const PAGE_UI = document.documentElement.dataset.ui || 'v4';

const html = `
<dialog id="mjp-settings">
  <h2>설정</h2>

  <section>
    <h3>화면</h3>
    <label class="mjp-radio"><input type="radio" name="mjp-ui" value="v4"> <b>V4</b> — 모바일 우선 테이블 화면 (실제 마작 테이블 배치)</label>
    <label class="mjp-radio"><input type="radio" name="mjp-ui" value="v1"> <b>V1</b> — 목록형 화면 (좌석별 행으로 버림패·후로 표시, 위에서 아래로 흐르는 카드 구성)</label>
    <p class="mjp-muted">두 화면은 <b>기능이 같습니다</b> (이론 해설·위험패 찾기·오답노트 모두 V4 시스템 그대로, 패는 같은 이미지). 화면 구성만 다릅니다. 고르면 바로 이동하며, 주소 끝에 <code>?ui=v1</code> / <code>?ui=v4</code>를 붙여도 됩니다.</p>
  </section>

  <section>
    <h3>대국 데이터</h3>
    <label class="mjp-radio"><input type="checkbox" id="mjp-tenhou"> <b>천봉에서 직접 받기</b> — 천봉명인전 패보 ID 목록 (패보는 이 브라우저가 천봉에서 한 판씩 천천히 받아 이 기기에만 저장)</label>
    <p id="mjp-tenhou-now" class="mjp-muted"></p>
  </section>

  <section>
    <h3>데이터 저장소 (선택)</h3>
    <p class="mjp-muted"><code>manifest.json</code>과 샤드(<code>shard-NNN.json.gz</code>)가 있는 폴더의 주소 (https, CORS 허용 필요). 이 주소는 이 브라우저에만 저장됩니다.</p>
    <input id="mjp-store-url" type="url" placeholder="https://…/폴더/" autocomplete="off" spellcheck="false">
    <div class="mjp-row"><button id="mjp-store-save" class="mjp-primary">연결 테스트 후 저장</button><button id="mjp-store-clear">연결 해제</button></div>
    <p class="mjp-muted">연결을 해제하면 다음에 열 때 메인 메뉴에서 다시 설정합니다.</p>
    <p id="mjp-store-msg" class="mjp-muted"></p>
    <p id="mjp-store-now" class="mjp-muted"></p>
    <p id="mjp-sync" class="mjp-muted"></p>
  </section>

  <section>
    <h3>로그 파일 가져오기 <small>(이번 방문 동안만)</small></h3>
    <input id="mjp-import" type="file" multiple accept=".xml,.mjlog,.gz,text/xml">
    <p id="mjp-import-msg" class="mjp-muted"></p>
  </section>

  <section>
    <h3>오답노트</h3>
    <p id="mjp-nb-count" class="mjp-muted"></p>
    <div class="mjp-row"><button id="mjp-nb-export">내보내기(JSON)</button><label class="mjp-file">가져오기<input id="mjp-nb-import" type="file" accept="application/json,.json" hidden></label></div>
    <p id="mjp-nb-msg" class="mjp-muted">이 브라우저에 저장됩니다. 브라우저 데이터를 지우면 사라지니 가끔 내보내 두세요. (V4·V1 화면이 같은 기록을 공유)</p>
  </section>

  <section>
    <h3>Mortal 엔진</h3>
    <select id="mjp-engine" class="mjp-select"></select>
    <p id="mjp-model" class="mjp-muted"></p>
    <div class="mjp-row"><button id="mjp-warm">지금 미리 불러오기</button><button id="mjp-del-engine" class="mjp-danger">이 엔진 삭제</button><button id="mjp-clear-logs">로그 캐시 지우기</button></div>
    <p class="mjp-muted">엔진을 바꾸면 <b>다음 문제부터</b> 적용됩니다 (이미 만들어 둔 문제는 이전 엔진의 분석 그대로입니다). 다른 엔진을 새로 받거나 모두 지우려면 <b>메인 메뉴</b>를 쓰세요. 오답노트는 어느 항목으로도 지워지지 않습니다.</p>
  </section>

  <p class="mjp-muted mjp-about">라이선스: 이 앱 AGPL-3.0 · 모델 가중치 Apache-2.0(수정본) · 패 이미지 CC0 ·
    <a id="mjp-l-notice" target="_blank" rel="noopener">NOTICE</a> · <a id="mjp-l-source" target="_blank" rel="noopener">소스 코드</a> · <a id="mjp-l-license" target="_blank" rel="noopener">LICENSE</a></p>
  <div class="mjp-row mjp-end"><a id="mjp-menu" class="mjp-linkbtn">메인 메뉴</a><button id="mjp-close">닫기</button></div>
</dialog>`;

const wrap = document.createElement('div');
wrap.innerHTML = html;
const dlg = wrap.firstElementChild;
document.body.append(dlg);
const $ = s => dlg.querySelector(s);

// ---- ⚙ 버튼 + 상태 칩 (헤더에 형제 요소로; V4의 #tabs 안에는 넣지 않는다) ----
const host = document.querySelector('#top') || document.querySelector('header') || document.body;
const chip = document.createElement('span'); chip.className = 'mjp-chip'; chip.hidden = true;
const gear = document.createElement('button'); gear.className = 'mjp-gear'; gear.type = 'button'; gear.title = '설정'; gear.setAttribute('aria-label', '설정'); gear.textContent = '⚙';
host.append(chip, gear);

if (settings.get().tenhou) loadTenhouList().catch(() => {});
const openDlg = () => { $('#mjp-store-url').value = settings.get().storeBase || ''; $('#mjp-tenhou').checked = !!settings.get().tenhou; refreshNb(); if (!dlg.open) dlg.showModal(); };
gear.onclick = () => openDlg();
$('#mjp-close').onclick = () => dlg.close();

// ---- 화면 선택 ----
for (const r of dlg.querySelectorAll('input[name=mjp-ui]')) {
  r.checked = r.value === PAGE_UI;
  r.onchange = () => {
    settings.patch({ ui: r.value });
    location.href = new URL(r.value + '/', ROOT).href;
  };
}

// ---- 데이터 저장소 ----
$('#mjp-store-save').onclick = async () => {
  const raw = $('#mjp-store-url').value.trim(), out = $('#mjp-store-msg');
  if (!raw) { disconnectStore({ forget: true }); out.textContent = '데이터 저장소 연결을 해제했습니다.'; return; }
  out.textContent = '연결 중…';
  try {
    const s = await connectStore(raw, { save: true });
    out.textContent = `연결됨: 대국 ${s.games}판 · 샤드 ${s.shards}개 · 응답 ${s.ms}ms`;
  } catch (e) { out.textContent = '실패: ' + e.message; }
};
$('#mjp-tenhou').onchange = e => settings.patch({ tenhou: e.target.checked });
$('#mjp-store-clear').onclick = () => { disconnectStore({ forget: true }); $('#mjp-store-url').value = ''; $('#mjp-store-msg').textContent = '연결을 해제했습니다.'; };

// ---- 로컬 로그 ----
$('#mjp-import').onchange = async e => {
  const r = await importFiles([...e.target.files]);
  $('#mjp-import-msg').textContent = `가져옴 ${r.ok}개${r.skipped ? ` · 건너뜀 ${r.skipped}개(로그 형식 아님)` : ''}`;
  e.target.value = '';
  if (r.ok) { dlg.close(); document.querySelector('#random')?.click(); }   // 바로 문제를 시작
};

// ---- 오답노트 ----
async function refreshNb() { try { $('#mjp-nb-count').textContent = `저장된 문제 ${await notebookCount()}개`; } catch { $('#mjp-nb-count').textContent = ''; } }
$('#mjp-nb-export').onclick = async () => {
  const db = await exportNotebook();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
  a.download = `mjp-notebook-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#mjp-nb-import').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const r = await importNotebook(JSON.parse(await f.text()));
    $('#mjp-nb-msg').textContent = `가져옴: 새 문제 ${r.added}개, 기록 병합 ${r.merged}개. 화면을 새로고침하면 반영됩니다.`;
    refreshNb();
  } catch (err) { $('#mjp-nb-msg').textContent = '실패: ' + err.message; }
};

// ---- 모델 ----
const engSel = $('#mjp-engine');
async function fillEngines() {
  let reg; try { reg = await getRegistry(); } catch { engSel.hidden = true; return; }
  const active = pickEngineId(reg);
  engSel.replaceChildren(...reg.engines.map(e => {
    const o = document.createElement('option'); o.value = e.id;
    o.textContent = `${e.name}${isInstalled(e) ? '' : ' (미설치)'}`; o.selected = e.id === active; return o;
  }));
  engSel.hidden = reg.engines.length < 2;
}
engSel.onchange = async () => {
  const reg = await getRegistry(), info = reg.engines.find(e => e.id === engSel.value);
  if (info && !isInstalled(info)) { $('#mjp-model').textContent = `"${info.name}"은(는) 아직 설치되지 않았습니다. 메인 메뉴에서 받은 뒤 선택하세요.`; fillEngines(); return; }
  useEngine(engSel.value); fillEngines();
};
dlg.addEventListener('toggle', () => { if (dlg.open) fillEngines(); });
$('#mjp-warm').onclick = () => ensureEngine(undefined, { allowDownload: true }).catch(e => { $('#mjp-model').textContent = e.message; });
// confirm() 대화상자는 브라우저가 막는 경우가 있어, 같은 버튼을 한 번 더 눌러 확인한다 (4초 안에)
const twoStep = (btn, label, run) => {
  if (btn._armed) { btn._armed = false; clearTimeout(btn._t); btn.textContent = btn._old; run(); return; }
  btn._armed = true; btn._old = btn.textContent; btn.textContent = label;
  btn._t = setTimeout(() => { btn._armed = false; btn.textContent = btn._old; }, 4000);
};
$('#mjp-del-engine').onclick = ev => twoStep(ev.currentTarget, '한 번 더 누르면 삭제', async () => {
  const reg = await getRegistry(), info = reg.engines.find(e => e.id === pickEngineId(reg));
  if (!info) return;
  await deleteEngine(info.id); $('#mjp-model').textContent = `"${info.name}" 삭제됨 (다음에 열 때 메인 메뉴에서 다시 받습니다)`; fillEngines();
});
$('#mjp-clear-logs').onclick = ev => twoStep(ev.currentTarget, '한 번 더 누르면 로그 캐시 삭제', async () => { $('#mjp-model').textContent = `로그 캐시 ${await clearLogCache()}개를 지웠습니다.`; });

// ---- 라이선스 링크 ----
$('#mjp-menu').href = ROOT + '?menu=1';
$('#mjp-l-notice').href = ROOT + 'NOTICE.md'; $('#mjp-l-source').href = ROOT + 'SOURCE.md'; $('#mjp-l-license').href = ROOT + 'LICENSE';

// ---- 상태 반영 ----
onState(s => {
  const sync = s.sync && !s.sync.finished ? `로그 동기화 ${s.sync.done}/${s.sync.total}` : '';
  const busy = s.engine === 'loading' ? s.engineMsg : '';
  chip.textContent = [busy, sync].filter(Boolean).join(' · ');
  chip.hidden = !chip.textContent;
  $('#mjp-model').textContent = s.model
    ? `${s.model.name} · ${(s.model.bytes / 1e6).toFixed(1)}MB · v${s.model.version} · ${s.model.from === 'cache' ? '캐시에서' : '네트워크에서'} 로딩 ${s.model.loadMs}ms`
    : (s.engineMsg || '아직 로딩 전 (처음 분석할 때 자동으로 내려받습니다)');
  $('#mjp-tenhou-now').textContent = s.tenhouGames ? `ID ${s.tenhouGames}판 · 이 기기에 받아 둔 패보 ${s.tenhouCached}판` : '';
  $('#mjp-store-now').textContent = s.store ? `현재 연결: ${s.store.base} (대국 ${s.store.games}판)` : (s.storeError ? `자동 연결 실패: ${s.storeError}` : '연결 안 됨');
  $('#mjp-sync').textContent = !s.sync ? '' : s.sync.finished
    ? `로그 ${s.store ? s.store.games : 0}판 캐시 완료${s.sync.error ? ' (일부 실패: ' + s.sync.error + ')' : ' — 이후 오프라인에서도 동작합니다'}`
    : `로그 동기화 중… ${s.sync.done}/${s.sync.total}`;
  $('#mjp-import-msg').textContent ||= s.local ? `가져온 로그 ${s.local}개 (새로고침하면 사라집니다)` : '';
});

// ---- 링크로 저장소 주소 전달: …/#store=<인코딩된 주소> ----
// 자동 저장하지 않는다. 채워서 보여 주고 사용자가 직접 "연결 테스트 후 저장"을 눌러야 한다 (악성 링크로 데이터 출처가 바뀌는 것을 막기 위해).
const m = location.hash.match(/^#store=(.+)$/);
if (m) {
  let url = '';
  try { url = decodeURIComponent(m[1]); } catch { /* 무시 */ }
  history.replaceState(null, '', location.pathname + location.search);
  if (url) { openDlg(); $('#mjp-store-url').value = url; $('#mjp-store-msg').textContent = '링크에서 받은 주소입니다. 아는 주소인지 확인하고, 맞으면 "연결 테스트 후 저장"을 누르세요.'; }
}

// 파일 모드(저장소 없음)로 열었는데 가져온 로그가 아직 없으면 안내와 함께 가져오기 창을 연다
if (settings.get().filesOnly && !settings.get().storeBase && !m) {
  openDlg();
  $('#mjp-import-msg').textContent = '천봉 로그(.xml)를 가져오면 바로 문제가 시작됩니다.';
}
