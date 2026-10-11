// 메인 메뉴(= 설정 화면, 사이트 루트): ① 엔진 ② 대국 데이터 ③ 화면 선택 → "시작하기"
//
// 이동 규칙 (설정을 하는 도중에 화면이 바뀌지 않도록):
//  - 화면(V4/V1) 선택과 엔진 선택은 설정만 저장한다. 이동하지 않는다.
//  - 이동은 "시작하기" 버튼으로만 한다.
//  - 자동 이동(메뉴를 건너뛰고 바로 화면으로)은 setupDone(한 번이라도 시작했거나 화면이 정상적으로 열린 적이 있음)일 때만 한다.
//  - V1/V4 화면은 준비가 안 됐으면 여기로 돌려보낸다 (core/boot.js)
//
// 엔진: 배포된 엔진 목록(model/engines.json)을 카드로 보여 주고, 엔진마다 선택·받기·삭제를 한다.
import {
  settings, state, onState, connectStore, getRegistry, pickEngineId, installedEngines, isInstalled, wasRemoved,
  useEngine, installEngine, deleteEngine, clearLogCache, resetSettings, clearEverything, pruneOrphanEngines, loadTenhouList,
} from './provider.js';

const ROOT = new URL('../', import.meta.url);        // 사이트 루트
const $ = id => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const mb = n => (n / 1e6).toFixed(1) + 'MB';

const q = new URLSearchParams(location.search);
const askedUi = q.get('ui');
if (askedUi === 'v1' || askedUi === 'v4') { settings.patch({ ui: askedUi }); q.delete('ui'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }

// #store=<주소> 링크: 입력칸에 채워만 둔다 (자동 저장하지 않는다)
let linkedStore = '';
{
  const m = location.hash.match(/^#store=(.+)$/);
  if (m) { try { linkedStore = decodeURIComponent(m[1]); } catch { /* 무시 */ } history.replaceState(null, '', location.pathname + location.search); }
}

const cfg = () => settings.get();
const chosenUi = () => (cfg().ui === 'v1' ? 'v1' : 'v4');
const openUi = ui => { location.href = new URL(ui + '/', ROOT).href; };

async function main() {
  let reg = null;
  try { reg = await getRegistry({ fresh: true }); } catch { /* 오프라인 등 → 저장된 기록만으로 판단 */ }
  if (reg) pruneOrphanEngines(reg);   // 엔진 목록에 없는 낡은 모델 캐시 정리 (백그라운드)

  // ---- 엔진 상태 도우미 ----
  const activeInfo = () => reg && reg.engines.find(e => e.id === pickEngineId(reg));
  // 엔진 목록을 못 받았으면(오프라인) 설치 기록이 하나라도 있는 한 준비된 것으로 본다
  const engineOk = () => (reg ? (activeInfo() && isInstalled(activeInfo())) : Object.keys(installedEngines()).length > 0);
  const storeOk = () => !!(cfg().storeBase || cfg().filesOnly || cfg().tenhou);
  const ready = () => !!engineOk() && storeOk();
  const wantMenu = q.has('menu') || !!linkedStore;     // ?from= 은 "돌려보내진 것"이라 메뉴 요청이 아님

  // ---- 시작한 적이 있고 모두 준비됨 → 메뉴 없이 바로 이동 ----
  if (!wantMenu && !q.has('from') && cfg().setupDone && ready()) {
    show('redirecting');
    openUi(chosenUi());
    return;
  }

  show('setup'); show('launch');
  // 이전에 한 번이라도 시작했거나 엔진을 설치한 적이 있으면 엔진 재준비(새 버전 배포·캐시 삭제)는 동의받은 것으로 보고 자동으로 한다.
  // (저장소 주소만 입력해 둔 정도로는 자동 다운로드를 시작하지 않는다)
  const consented = !!(cfg().setupDone || Object.keys(installedEngines()).length);
  if (q.get('from')) {
    const note = document.createElement('p'); note.className = 'muted';
    note.textContent = reg && wasRemoved(pickEngineId(reg)) ? `${q.get('from').toUpperCase()} 화면은 엔진이 있어야 열립니다. 지운 엔진을 다시 받거나 다른 엔진을 고르세요.` : `${q.get('from').toUpperCase()} 화면을 열려면 먼저 아래 준비가 필요합니다.`;
    $('setup').prepend(note);
  }

  // 확인 대화상자(confirm)는 브라우저가 막는 경우가 있어, 같은 버튼을 한 번 더 눌러 확인하는 방식을 쓴다
  let armed = null, armTimer = 0;
  const twoStep = (key, btn, label, run) => {
    if (armed === key) { armed = null; clearTimeout(armTimer); run(); return; }
    armed = key; clearTimeout(armTimer);
    const old = btn.textContent; btn.textContent = label; btn.classList.add('armed');
    armTimer = setTimeout(() => { armed = null; btn.textContent = old; btn.classList.remove('armed'); }, 4000);
  };

  // ---- ① 엔진 목록 ----
  const busy = new Set();     // 받는 중인 엔진 id
  async function install(id, { start = false, auto = false } = {}) {
    if (busy.has(id)) return;
    busy.add(id); render();
    try { await installEngine(id, { start }); }
    catch (e) { $('engine-msg').textContent = `엔진 준비 실패: ${e.message} (이 브라우저가 WebAssembly를 지원하는지 확인하세요)`; }
    busy.delete(id); render();
    // 화면에서 돌려보내진 기존 사용자의 '자동' 재준비가 끝난 경우에만 원래 화면으로 복귀 (사용자가 직접 누른 받기는 메뉴에 머문다)
    if (auto && q.has('from') && !q.has('menu') && cfg().setupDone && ready()) openUi(chosenUi());
  }

  function renderEngines() {
    const list = $('engine-list');
    if (!reg) { list.textContent = '엔진 목록을 불러오지 못했습니다 (오프라인?). 설치 기록이 있으면 그대로 시작할 수 있습니다.'; return; }
    const activeId = pickEngineId(reg), many = reg.engines.length > 1;
    list.replaceChildren(...reg.engines.map(e => {
      const inst = installedEngines()[e.id];
      const row = document.createElement('div');
      row.className = 'engine' + (e.id === activeId ? ' sel' : '');
      row.dataset.id = e.id;
      const dot = document.createElement('span'); dot.className = 'dot'; dot.hidden = !many;
      const body = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = e.name;
      const ds = document.createElement('div'); ds.className = 'ds'; ds.textContent = `${e.description} · ${mb(e.bytes)}`;
      const st = document.createElement('div');
      if (busy.has(e.id)) { st.className = 'st old'; st.textContent = '내려받는 중…'; }
      else if (inst === e.version) { st.className = 'st ok'; st.textContent = `✓ 설치됨 (v${e.version})`; }
      else if (inst) { st.className = 'st old'; st.textContent = `새 버전이 있습니다 (설치된 v${inst} → v${e.version})`; }
      else { st.className = 'st no'; st.textContent = '설치 안 됨'; }
      body.append(nm, ds, st);
      const ac = document.createElement('div'); ac.className = 'ac';
      if (inst !== e.version) {
        const b = document.createElement('button'); b.className = 'primary'; b.textContent = inst ? '업데이트' : '받기'; b.disabled = busy.has(e.id);
        b.onclick = ev => { ev.stopPropagation(); useEngine(e.id); install(e.id, { start: e.id === activeId || !Object.keys(installedEngines()).length }); };
        ac.append(b);
      }
      if (inst) {
        const d = document.createElement('button'); d.className = 'danger'; d.textContent = '삭제'; d.disabled = busy.has(e.id);
        d.onclick = async ev => {
          ev.stopPropagation();
          twoStep('eng:' + e.id, d, '한 번 더 누르면 삭제', async () => { await deleteEngine(e.id); $('engine-msg').textContent = `"${e.name}" 삭제됨 (다시 받을 수 있습니다)`; render(); });
        };
        ac.append(d);
      }
      row.append(dot, body, ac);
      row.onclick = () => { if (many && e.id !== activeId) { useEngine(e.id); render(); } };   // 선택만 한다 (이동·다운로드 없음)
      return row;
    }));
  }

  // ---- ② 대국 데이터: 천봉 직접 받기 (기본) + 다른 출처(저장소/파일) ----
  const tenhouBox = $('tenhou-on');
  tenhouBox.checked = !!cfg().tenhou;
  tenhouBox.onchange = () => { settings.patch({ tenhou: tenhouBox.checked }); render(); };
  loadTenhouList().then(l => { $('tenhou-count').textContent = `— 명인전 ${l.length}판`; }).catch(() => { $('tenhou-msg').textContent = '패보 ID 목록을 불러오지 못했습니다.'; });
  if (cfg().storeBase || cfg().filesOnly) $('more-src').open = true;
  $('store-url').value = linkedStore || cfg().storeBase || '';
  if (linkedStore) $('store-msg').textContent = '링크에서 받은 주소입니다. 아는 주소인지 확인하고, 맞으면 "연결 테스트 후 저장"을 누르세요.';
  $('store-go').onclick = async () => {
    const raw = $('store-url').value.trim();
    if (!raw) { $('store-msg').textContent = '주소를 입력하세요.'; return; }
    $('store-msg').textContent = '연결 중…'; $('store-go').disabled = true;
    try {
      const s = await connectStore(raw, { save: true });
      settings.patch({ filesOnly: false });
      $('store-msg').textContent = `연결됨: 대국 ${s.games}판 · 샤드 ${s.shards}개 · 응답 ${s.ms}ms`;
    } catch (e) { $('store-msg').textContent = '실패: ' + e.message; }
    $('store-go').disabled = false; render();
  };
  $('files-only').onclick = e => { e.preventDefault(); settings.patch({ filesOnly: true }); $('store-msg').textContent = '파일 모드: 시작한 뒤 화면 안의 ⚙ 설정에서 로그 파일을 가져오세요.'; render(); };
  if (cfg().storeBase && !linkedStore) {            // 저장된 주소는 자동으로 연결 상태를 확인한다 (이동은 하지 않음)
    connectStore(cfg().storeBase).then(s => { $('store-msg').textContent = `연결됨: 대국 ${s.games}판 · 샤드 ${s.shards}개 · 응답 ${s.ms}ms`; render(); })
      .catch(e => { $('store-msg').textContent = '연결 확인 실패: ' + e.message + ' (오프라인이면 저장된 로그로 시작할 수 있습니다)'; render(); });
  }

  // ---- ③ 화면 선택: 저장만 한다 (이동 없음) ----
  const pick = ui => { settings.patch({ ui }); render(); };
  $('pick-v4').onclick = () => pick('v4');
  $('pick-v1').onclick = () => pick('v1');

  // ---- 시작하기: 이동은 여기서만 ----
  $('start').onclick = () => { if (!ready()) return; settings.patch({ ui: chosenUi(), setupDone: true }); openUi(chosenUi()); };

  // ---- 저장 공간 관리 ----
  const afterClear = msg => { $('engine-msg').textContent = msg; render(); };
  $('clr-logs').onclick = ev => twoStep('logs', ev.currentTarget, '한 번 더 누르면 로그 캐시 삭제', async () => afterClear(`로그 캐시 ${await clearLogCache()}개 삭제됨`));
  $('clr-settings').onclick = ev => twoStep('settings', ev.currentTarget, '한 번 더 누르면 설정 초기화', () => { resetSettings(); location.href = location.pathname + '?menu=1'; });
  $('clr-all').onclick = ev => twoStep('all', ev.currentTarget, '한 번 더 누르면 전부 삭제', async () => { await clearEverything(); location.href = location.pathname + '?menu=1'; });

  function render() {
    const eOk = !!engineOk(), sOk = storeOk(), uiSet = !!cfg().ui;
    $('c-engine').classList.toggle('done', eOk); $('b-engine').textContent = eOk ? '✓' : '①';
    $('c-store').classList.toggle('done', sOk); $('b-store').textContent = sOk ? '✓' : '②';
    $('c-ui').classList.toggle('done', uiSet); $('b-ui').textContent = uiSet ? '✓' : '③';
    renderEngines();
    for (const ui of ['v4', 'v1']) {
      const on = uiSet && chosenUi() === ui;
      $('pick-' + ui).classList.toggle('sel', on); $('pick-' + ui).setAttribute('aria-checked', String(on));
    }
    $('start').disabled = !ready();
    const ai = activeInfo();
    $('start').textContent = ready() ? `시작하기 → ${chosenUi().toUpperCase()} 화면${reg && reg.engines.length > 1 && ai ? ` · ${ai.name}` : ''}` : '시작하기';
    const missing = [!eOk && '① 엔진', !sOk && '② 데이터 저장소'].filter(Boolean);
    $('start-hint').textContent = ready() ? '시작하면 이후에는 이 주소(/)가 바로 선택한 화면으로 이동합니다.' : `아직 끝나지 않은 단계: ${missing.join(' · ')}`;
  }

  onState(s => {
    const prog = $('engine-prog');
    prog.hidden = !(s.engine === 'loading' && s.engineProgress);
    if (s.engineProgress) prog.value = s.engineProgress.got / s.engineProgress.total;
    if (s.engine === 'loading') $('engine-msg').textContent = s.engineMsg;
    if (s.sync && !s.sync.finished && s.store) $('store-msg').textContent = `연결됨: 대국 ${s.store.games}판 · 로그 동기화 ${s.sync.done}/${s.sync.total}`;
    else if (s.sync && s.sync.finished && s.store) $('store-msg').textContent = `연결됨: 대국 ${s.store.games}판 · 로그 ${s.store.games}판 캐시 완료`;
    render();
  });
  render();

  // 동의한 적이 있으면(새 버전 배포·엔진 삭제 후 재시작 등) 선택된 엔진의 재준비를 자동으로 시작한다
  // (사용자가 직접 지운 엔진은 되살리지 않는다 — 메뉴에서 멈춰 직접 고르게 한다. 새 버전 배포로 낡아진 경우만 자동.)
  if (reg && !engineOk() && consented && !wasRemoved(pickEngineId(reg))) install(pickEngineId(reg), { start: true, auto: true });
}

main();
