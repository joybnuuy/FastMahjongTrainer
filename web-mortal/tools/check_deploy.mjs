// 배포된 주소가 제대로 서빙되는지 확인 (MIME, 크기, 캐시 헤더). 읽기 요청만 보낸다.
// 사용: node web-mortal/tools/check_deploy.mjs https://<사용자>.github.io/mahjong/
const base = (process.argv[2] || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(base)) { console.error('사용법: node check_deploy.mjs https://…/mahjong/'); process.exit(2); }

const expect = [
  ['index.html', /text\/html/], ['app.css', /text\/css/], ['js/app.js', /javascript/], ['js/provider.js', /javascript/], ['js/worker.js', /javascript/],
  ['js/mortal-web.js', /javascript/], ['vendor/core/mortal_wasm_core.js', /javascript/], ['vendor/core/mortal_wasm_core_bg.wasm', /application\/wasm/],
  ['vendor/ort/ort.wasm.min.mjs', /javascript/], ['vendor/ort/ort-wasm-simd-threaded.mjs', /javascript/], ['vendor/ort/ort-wasm-simd-threaded.wasm', /application\/wasm/],
  ['model/model.json', /json/], ['NOTICE.md', null], ['LICENSE', null], ['SOURCE.md', null],
];
let bad = 0;
const row = (...c) => console.log(c.join('  '));
for (const [p, mime] of expect) {
  try {
    const t = performance.now();
    const r = await fetch(base + p + '?chk=' + Date.now());
    const buf = await r.arrayBuffer();
    const type = r.headers.get('content-type') || '';
    const okMime = mime ? mime.test(type) : true;
    if (!r.ok || !okMime) bad++;
    row(r.ok ? 'OK ' : 'ERR', String(r.status), (buf.byteLength / 1e3).toFixed(0).padStart(7) + 'KB', `${(performance.now() - t).toFixed(0).padStart(5)}ms`, p.padEnd(42), okMime ? type : `MIME 이상: ${type}`, `cache-control=${r.headers.get('cache-control')}`, `encoding=${r.headers.get('content-encoding') || '-'}`);
  } catch (e) { bad++; row('ERR', p, e.message); }
}
// 모델 파일: model.json 의 bytes 와 실제 크기 일치 확인
try {
  const info = await (await fetch(base + 'model/model.json?chk=' + Date.now())).json();
  const t = performance.now();
  const r = await fetch(`${base}model/${info.file}?v=${info.version}`);
  const n = (await r.arrayBuffer()).byteLength;
  const ok = r.ok && n === info.bytes;
  if (!ok) bad++;
  row(ok ? 'OK ' : 'ERR', String(r.status), (n / 1e6).toFixed(2).padStart(7) + 'MB', `${(performance.now() - t).toFixed(0).padStart(5)}ms`, `model/${info.file}`.padEnd(42), ok ? `크기 일치(${info.bytes}B) v${info.version}` : `크기 불일치: ${n} != ${info.bytes}`, `encoding=${r.headers.get('content-encoding') || '-'}`);
} catch (e) { bad++; row('ERR', 'model', e.message); }
console.log(bad ? `\n문제 ${bad}건` : '\n모두 정상');
process.exit(bad ? 1 : 0);
