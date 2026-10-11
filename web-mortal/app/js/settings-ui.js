// 설정 대화상자: 데이터 저장소 URL, 로컬 파일 가져오기, 모델 상태/캐시
import { settings, state, onState, connectStore, disconnectStore, importFiles, ensureEngine, clearModelCache } from './provider.js';

const $ = s => document.querySelector(s);
const dlg = $('#settings');

$('#openSettings').onclick = () => { $('#storeUrl').value = settings.get().storeBase || ''; dlg.showModal(); };
$('#closeSettings').onclick = () => dlg.close();

$('#storeSave').onclick = async () => {
  const raw = $('#storeUrl').value.trim();
  const out = $('#storeMsg');
  if (!raw) { disconnectStore({ forget: true }); out.textContent = '데이터 저장소 연결을 해제했습니다.'; return; }
  out.textContent = '연결 중…';
  try {
    const s = await connectStore(raw, { save: true });
    out.textContent = `연결됨: 대국 ${s.games}판 · 샤드 ${s.shards}개 · 응답 ${s.ms}ms`;
  } catch (e) { out.textContent = '실패: ' + e.message; }
};

$('#importFiles').onchange = async e => {
  const r = await importFiles([...e.target.files]);
  $('#localMsg').textContent = `가져옴 ${r.ok}개${r.skipped ? ` · 건너뜀 ${r.skipped}개(로그 형식 아님)` : ''}`;
  e.target.value = '';
};

// 링크로 저장소 주소 전달: https://…/mahjong/#store=<인코딩된 주소>
// 자동 저장하지 않는다. 설정 창에 채워서 보여 주고, 사용자가 직접 "연결 테스트 후 저장"을 눌러야 한다
// (악성 링크 하나로 남의 데이터 출처를 바꾸는 것을 막기 위해).
{
  const m = location.hash.match(/^#store=(.+)$/);
  if (m) {
    let url = '';
    try { url = decodeURIComponent(m[1]); } catch { /* 무시 */ }
    history.replaceState(null, '', location.pathname + location.search);
    if (url) {
      $('#storeUrl').value = url;
      $('#storeMsg').textContent = '링크에서 받은 주소입니다. 아는 주소인지 확인하고, 맞으면 "연결 테스트 후 저장"을 누르세요.';
      dlg.showModal();
    }
  }
}

$('#warmModel').onclick = () => ensureEngine().catch(() => {});
$('#clearModel').onclick = async () => { await clearModelCache(); };

onState(s => {
  const syncMsg = s.sync && !s.sync.finished ? `로그 동기화 ${s.sync.done}/${s.sync.total}` : '';
  $('#engine').textContent = [s.engineMsg, syncMsg].filter(Boolean).join(' · ');
  $('#syncInfo').textContent = !s.sync ? '' : s.sync.finished
    ? `로그 ${s.store ? s.store.games : 0}판 캐시 완료${s.sync.error ? ' (일부 실패: ' + s.sync.error + ')' : ' — 이후 오프라인에서도 동작합니다'}`
    : `로그 동기화 중… ${s.sync.done}/${s.sync.total}`;
  $('#modelInfo').textContent = s.model
    ? `${s.model.name} · ${(s.model.bytes / 1e6).toFixed(1)}MB · v${s.model.version} · ${s.model.from === 'cache' ? '캐시에서' : '네트워크에서'} 로딩 ${s.model.loadMs}ms`
    : (s.engineMsg || '아직 로딩 전 (처음 분석할 때 자동으로 내려받습니다)');
  $('#storeNow').textContent = s.store
    ? `현재 연결: ${s.store.base} (대국 ${s.store.games}판)`
    : (s.storeError ? `자동 연결 실패: ${s.storeError}` : '연결 안 됨');
  $('#localNow').textContent = s.local ? `가져온 로그 ${s.local}개 (새로고침하면 사라집니다)` : '';
});
