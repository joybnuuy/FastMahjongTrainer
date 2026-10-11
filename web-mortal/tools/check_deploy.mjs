// 배포된 주소가 제대로 서빙되는지 확인 (MIME, 크기, 캐시 헤더). 읽기 요청만 보낸다.
// 사용: node web-mortal/tools/check_deploy.mjs https://<사용자>.github.io/mahjong/
const base = (process.argv[2] || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(base)) { console.error('사용법: node check_deploy.mjs https://…/mahjong/'); process.exit(2); }

const expect = [
  ['index.html', /text\/html/], ['v4/index.html', /text\/html/], ['v1/index.html', /text\/html/],
  ['v4/style.css', /text\/css/], ['v1/skin.css', /text\/css/], ['core/core.css', /text\/css/],
  ['v4/js/app.js', /javascript/], ['v4/js/table.js', /javascript/], ['v4/js/worker.js', /javascript/], ['v1/js/table-v1.js', /javascript/],
  ['core/boot.js', /javascript/], ['core/menu.js', /javascript/], ['core/menu.css', /text\/css/], ['core/notebook.js', /javascript/], ['core/idb.js', /javascript/], ['core/engine-worker.js', /javascript/], ['core/engine-client.js', /javascript/], ['core/provider.js', /javascript/], ['core/settings-ui.js', /javascript/], ['core/mortal-web.js', /javascript/],
  ['v4/tiles/libre/m1.svg', /image\/svg\+xml/], ['v4/tiles/libre/LICENSE-CC0.txt', null],
  ['vendor/core/mortal_wasm_core.js', /javascript/], ['vendor/core/mortal_wasm_core_bg.wasm', /application\/wasm/],
  ['vendor/ort/ort.wasm.min.mjs', /javascript/], ['vendor/ort/ort-wasm-simd-threaded.mjs', /javascript/], ['vendor/ort/ort-wasm-simd-threaded.wasm', /application\/wasm/],
  ['model/engines.json', /json/], ['data/meijin.json', /json/], ['NOTICE.md', null], ['LICENSE', null], ['SOURCE.md', null],
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
// 엔진 목록(model/engines.json): 형식, 기본 엔진 존재, 각 엔진 파일의 크기·버전 일치 확인
try {
  const reg = await (await fetch(base + 'model/engines.json?chk=' + Date.now())).json();
  const fmtOk = reg.format === 1 && Array.isArray(reg.engines) && reg.engines.length > 0 && reg.engines.some(e => e.id === reg.default);
  if (!fmtOk) bad++;
  row(fmtOk ? 'OK ' : 'ERR', '   ', `엔진 ${reg.engines?.length ?? 0}개`.padStart(10), '     ', 'model/engines.json'.padEnd(42), fmtOk ? `기본 엔진: ${reg.default}` : '형식 이상(format/engines/default)');
  for (const info of reg.engines || []) {
    const t = performance.now();
    const r = await fetch(`${base}model/${info.file}?v=${info.version}`);
    const n = (await r.arrayBuffer()).byteLength;
    const ok = r.ok && n === info.bytes && /^[0-9a-f]{12}$/.test(info.version) && info.sha256?.startsWith(info.version);
    if (!ok) bad++;
    row(ok ? 'OK ' : 'ERR', String(r.status), (n / 1e6).toFixed(2).padStart(7) + 'MB', `${(performance.now() - t).toFixed(0).padStart(5)}ms`, `model/${info.file}`.padEnd(42), ok ? `크기 일치(${info.bytes}B) v${info.version} · ${info.id}` : `이상: 크기 ${n} vs ${info.bytes}, 버전 ${info.version}`, `encoding=${r.headers.get('content-encoding') || '-'}`);
  }
} catch (e) { bad++; row('ERR', 'model', e.message); }
console.log(bad ? `\n문제 ${bad}건` : '\n모두 정상');
process.exit(bad ? 1 : 0);
