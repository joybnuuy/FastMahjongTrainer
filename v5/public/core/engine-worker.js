// 엔진 전용 워커: onnxruntime-web + wasm 인코더를 이 워커 안에서만 돌린다.
// wasm 메모리는 한 번 커지면 줄지 않으므로, 메모리를 확실히 돌려주려면 워커를 종료(terminate)해야 한다.
// (ort 의 proxy 워커는 외부에서 종료할 수 없어서 직접 워커를 둔다.) 화면을 떠나거나 엔진을 바꿀 때 메인이 이 워커를 종료한다.
import { MortalWeb } from './mortal-web.js';

// WebKit(iOS/macOS Safari 및 iOS 의 모든 브라우저) 버그 대응: WebAssembly.Memory 를 만든 직후 .buffer 를 한 번 읽어 두면
// 페이지를 오갈 때 메모리가 해제되지 않고 쌓여 "RangeError: Out of memory" 가 나는 문제가 사라진다는 보고가 있다
// (emscripten-core/emscripten#19374, WebKit bug 256023 / 222097). 동작에는 영향이 없다. onnxruntime/wasm-bindgen 이 내부에서
// 메모리를 만들기 때문에 생성자를 감싸서 적용한다 (아래 dynamic import 보다 먼저 실행되어야 한다).
const mems = [];
if (typeof WebAssembly !== 'undefined' && WebAssembly.Memory && !WebAssembly.Memory.__mjpTouched) {
  const Orig = WebAssembly.Memory;
  // onnxruntime 은 공유 메모리의 최대치를 4GB(65536쪽)로 선언한다. 실제 사용량은 40~50MB 수준이라, iOS 에서 큰 주소 공간 예약이 실패하는 일을
  // 줄이도록 최대치를 낮춘다(가져오는 쪽 선언보다 작은 최대치는 허용된다). 한도를 넘으면 기존과 같은 메모리 부족 오류가 난다.
  const MAX_PAGES = 8192;   // 512MB
  const Wrapped = new Proxy(Orig, { construct(target, args) {
    const d = args[0];
    if (d && d.shared && d.maximum > MAX_PAGES) args = [{ ...d, maximum: MAX_PAGES }, ...args.slice(1)];
    const m = new target(...args); mems.push(m); try { void m.buffer; } catch { /* 무시 */ } return m; } });
  Object.defineProperty(Wrapped, '__mjpTouched', { value: true });
  WebAssembly.Memory = Wrapped;
}

let web = null;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  const reply = (ok, payload) => self.postMessage(ok ? { id, ok, result: payload } : { id, ok, error: String(payload && payload.message || payload) });
  try {
    if (type === 'init') {
      const ort = await import(data.ortUrl);
      ort.env.wasm.wasmPaths = data.ortBase;
      ort.env.wasm.numThreads = 1;      // github.io 는 COOP/COEP 헤더를 줄 수 없어 멀티스레드 불가
      ort.env.wasm.proxy = false;       // 이 워커가 이미 메인 스레드와 분리되어 있다
      const core = await import(data.coreJs);
      await core.default({ module_or_path: data.coreWasm });
      web = await MortalWeb.create({ ort, core, model: data.model });
      reply(true, null);
    } else if (type === 'stats') {
      reply(true, mems.map(m => m.buffer.byteLength));
    } else if (type === 'analyze') {
      reply(true, await web.analyze(data.events, data.requests));
    } else reply(false, new Error('알 수 없는 요청: ' + type));
  } catch (e) { reply(false, e); }
};
