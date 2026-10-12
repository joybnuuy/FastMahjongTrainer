// 빌드 번호 표시 (맨 아래 라이선스 줄 근처): 화면이 캐시된 이전 버전인지 한눈에 확인하기 위한 것.
//  - 각 JS 파일은 빌드 때 치환되는 빌드 번호를 자기 안에 갖고 있다 (globalThis.__MJP.builds).
//  - 엔진 워커/인코더 JS, wasm 두 개(내용 해시 기반 번호)는 엔진을 시작하거나 실행 프로그램을 받은 뒤에 알 수 있다.
//  - 서버의 build.json(캐시 없이 요청)과 비교해 "새 버전이 있음"도 알려 준다.
(globalThis.__MJP ??= { builds: {} }).builds.buildinfo = '__MJP_BUILD__';
import { state, onState } from './provider.js';

const SITE = new URL('../', import.meta.url);
const TOKEN = '__MJP' + '_BUILD__';     // 치환되지 않는 개발용 자리표시 값 (리터럴로 쓰면 빌드가 이것도 치환해 버린다)
let latest = null;      // 서버의 최신 빌드 번호 (모르면 null)

function compute() {
  const mine = globalThis.__MJP.builds;
  const groups = { ...mine };
  const rb = state.runtimeBuild;
  if (rb) { groups['워커'] = rb.worker; groups['인코더JS'] = rb.mortalWeb; }
  const ids = [...new Set(Object.values(groups).filter(x => x && x !== TOKEN))];
  const dev = Object.values(mine).every(x => x === TOKEN);
  const wasm = state.wasmBuilds, wasmBad = wasm && Object.entries(wasm).filter(([, v]) => v.expected && v.found !== v.expected).map(([k]) => k);
  const wasmTxt = wasm ? ` · wasm ${Object.entries(wasm).map(([k, v]) => `${k} ${v.found || '?'}`).join(' / ')}` : '';
  if (dev) return { cls: 'dev', text: '개발 빌드 (번호 없음)' };
  if (ids.length > 1) {
    return { cls: 'bad', text: `⚠ 서로 다른 빌드의 파일이 섞여 있습니다 (캐시 때문일 수 있음): ${Object.entries(groups).map(([k, v]) => `${k}=${v}`).join(', ')} — 새로고침(또는 사이트 데이터 삭제) 해 주세요` };
  }
  const id = ids[0];
  if (latest && latest !== id) return { cls: 'bad', text: `⚠ 이전 빌드(${id})가 보이고 있습니다. 최신은 ${latest} — 새로고침해 주세요` };
  if (wasmBad && wasmBad.length) return { cls: 'bad', text: `⚠ 빌드 ${id} · wasm 번호가 기대와 다릅니다(${wasmBad.join(', ')}) — 엔진 삭제 후 다시 받아 보세요` };
  return { cls: latest ? 'ok' : '', text: `빌드 ${id}${latest ? ' (최신)' : ''}${rb ? ' · 워커 일치' : ''}${wasmTxt}` };
}

export function mountBuildInfo() {
  const foot = document.querySelector('footer');
  if (!foot || document.getElementById('mjp-buildinfo')) return;
  const el = document.createElement('div');
  el.id = 'mjp-buildinfo'; el.className = 'mjp-buildinfo';
  foot.append(el);
  const render = () => { const r = compute(); el.textContent = r.text; el.dataset.state = r.cls; };
  onState(render);
  render();
  fetch(new URL('build.json', SITE).href, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j && j.id) { latest = j.id; render(); } }).catch(() => {});
}
