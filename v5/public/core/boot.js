// V5 시작 스크립트: V1/V4 두 화면이 공통으로 가장 먼저(app.js 보다 앞서) 불러온다.
//  1) 준비가 안 됐으면(엔진 준비 기록이 없거나, 데이터 저장소도 파일 모드도 설정 안 됨) 메인 메뉴(사이트 루트)로 돌려보낸다
//  2) 설정의 화면(ui)이 현재 페이지와 다르면 해당 화면으로 이동
//  3) 같으면 /api/* 가로채기(provider)와 설정 창을 설치. 새 모델이 배포되었으면 메뉴에서 다시 준비하도록 보낸다
(globalThis.__MJP ??= { builds: {} }).builds.boot = '__MJP_BUILD__';   // 빌드 번호(빌드 때 치환)
import { settings, install, fetchEngines, pickEngineId } from './provider.js';

const ROOT = new URL('../', import.meta.url);     // 사이트 루트 = 메인 메뉴 (…/mahjong/)
const page = document.documentElement.dataset.ui || 'v4';
const qs = new URLSearchParams(location.search);
const asked = qs.get('ui');
if (asked === 'v1' || asked === 'v4') {            // ?ui=v1 → 설정에 저장하고 주소에서 제거
  settings.patch({ ui: asked });
  qs.delete('ui');
  history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
}

// 이 페이지의 app.js 가 불필요한 로딩을 시작하지 않도록 /api 요청을 영원히 대기시키고 이동한다
const leave = url => { window.fetch = () => new Promise(() => {}); location.replace(url); };
const toMenu = () => leave(new URL('?from=' + page, ROOT).href + location.hash);   // #store=… 같은 해시는 메뉴가 처리한다

const cfg = settings.get();
const want = cfg.ui || page;          // 화면을 고른 적이 없으면 선호가 없는 것: 직접 연 페이지를 그대로 쓴다
const installed = cfg.engines || {};   // {엔진id: 설치된 버전}
// 준비됨 = (선택된 엔진, 없으면 아무 엔진이든) 설치 기록이 있고, 저장소 주소가 있거나 파일 모드
const readyEngine = cfg.engineId && installed[cfg.engineId] ? cfg.engineId : Object.keys(installed)[0];
const setUp = !!(readyEngine && (cfg.storeBase || cfg.filesOnly || cfg.tenhou));

if (!setUp) {
  toMenu();
} else if (want !== page) {
  leave(new URL(want + '/', ROOT).href + location.search + location.hash);
} else {
  if (!cfg.setupDone || !cfg.ui) settings.patch({ setupDone: true, ui: cfg.ui || page });   // 이 화면이 정상적으로 열렸다 = 사용을 시작했다 (이후 /mahjong/ 은 바로 여기로 보낸다)
  // 선택된 엔진이 아직 유효한지 확인한다: 엔진 목록에서 사라졌거나 새 버전이 배포되었으면 메뉴에서 다시 준비하게 한다.
  // (네트워크가 없거나 느리면 그냥 진행.) 확인이 끝날 때까지 첫 /api 요청을 보류하는 게이트로 쓴다.
  const gate = (async () => {
    try {
      const reg = await Promise.race([fetchEngines(), new Promise((_, no) => setTimeout(no, 2500))]);
      const id = pickEngineId(reg, cfg);
      const info = reg.engines.find(e => e.id === id);
      if (installed[id] !== info.version) { toMenu(); await new Promise(() => {}); }
    } catch { /* 확인 불가 → 진행 */ }
  })();
  install({ gate });              // 동기적으로 fetch 를 가로채야 한다 (app.js 의 첫 요청보다 먼저)
  import('./settings-ui.js');
  import('./buildinfo.js').then(m => m.mountBuildInfo());
}
