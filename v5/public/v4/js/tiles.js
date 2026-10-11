// 리치마작 패 SVG 렌더러 (외부 이미지 없음). kind: 0-8 만, 9-17 통, 18-26 삭, 27-33 東南西北白發中
const FONT = `'Yu Mincho','Hiragino Mincho ProN','MS Mincho','Noto Serif CJK JP','Noto Serif JP',serif`;
const C = { blue: '#1c5aa6', red: '#c8321f', green: '#1d8248', ink: '#1b1b1b', white: '#fdfcf6' };
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HON = ['東', '南', '西', '北', '白', '發', '中'];

// ---- 통수: 동심원 ----
function pin(cx, cy, r, col, big = false) {
  if (big) { // 1통: 다색 큰 원
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.blue}"/><circle cx="${cx}" cy="${cy}" r="${r * .82}" fill="${C.white}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * .72}" fill="${C.green}"/><circle cx="${cx}" cy="${cy}" r="${r * .55}" fill="${C.white}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * .42}" fill="${C.red}"/><circle cx="${cx}" cy="${cy}" r="${r * .16}" fill="${C.white}"/>`;
  }
  const c = C[col];
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/><circle cx="${cx}" cy="${cy}" r="${r * .7}" fill="${C.white}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * .5}" fill="${c}"/><circle cx="${cx}" cy="${cy}" r="${r * .2}" fill="${C.white}"/>`;
}
const PIN = {
  1: () => pin(24, 34, 17, 'blue', true),
  2: () => pin(24, 19, 10.5, 'green') + pin(24, 49, 10.5, 'blue'),
  3: () => pin(13, 14, 9, 'blue') + pin(24, 34, 9, 'red') + pin(35, 54, 9, 'green'),
  4: () => pin(14, 20, 9.5, 'blue') + pin(34, 20, 9.5, 'green') + pin(14, 48, 9.5, 'green') + pin(34, 48, 9.5, 'blue'),
  5: (red) => pin(13, 17, 8.5, 'blue') + pin(35, 17, 8.5, 'green') + pin(13, 51, 8.5, 'green') + pin(35, 51, 8.5, 'blue') + pin(24, 34, red ? 10.5 : 8.5, 'red'),
  6: () => pin(14, 14, 8, 'green') + pin(34, 14, 8, 'green') + [[14, 36], [34, 36], [14, 56], [34, 56]].map(([x, y]) => pin(x, y, 8, 'red')).join(''),
  7: () => pin(10, 10, 6.2, 'green') + pin(24, 18, 6.2, 'green') + pin(38, 26, 6.2, 'green') + [[14, 44], [34, 44], [14, 59], [34, 59]].map(([x, y]) => pin(x, y, 7, 'red')).join(''),
  8: () => [[14, 12], [14, 26], [14, 40], [14, 54], [34, 12], [34, 26], [34, 40], [34, 54]].map(([x, y]) => pin(x, y, 6.6, 'blue')).join(''),
  9: () => [[11, 16, 'green'], [24, 16, 'green'], [37, 16, 'green'], [11, 34, 'red'], [24, 34, 'red'], [37, 34, 'red'], [11, 52, 'blue'], [24, 52, 'blue'], [37, 52, 'blue']].map(([x, y, c]) => pin(x, y, 6.8, c)).join(''),
};

// ---- 삭수: 대나무 ----
function stick(cx, cy, h, col, w = 8) {
  const c = C[col], x = cx - w / 2, y = cy - h / 2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.4" fill="${c}"/>` +
    `<rect x="${x + 1.4}" y="${y + 1}" width="${w * .28}" height="${h - 2}" rx="1" fill="#fff" opacity=".28"/>` +
    `<rect x="${x - .6}" y="${cy - 1}" width="${w + 1.2}" height="2" rx="1" fill="${C.white}"/>` +
    `<rect x="${x - .6}" y="${y + h * .22}" width="${w + 1.2}" height="1.4" fill="${C.white}" opacity=".85"/>` +
    `<rect x="${x - .6}" y="${y + h * .78}" width="${w + 1.2}" height="1.4" fill="${C.white}" opacity=".85"/>`;
}
const bird = () => // 1삭: 공작(단순화)
  `<path d="M24 12 C16 12 14 21 20 25 C13 30 12 42 20 50 L17 62 L24 56 L31 62 L28 50 C36 42 35 30 28 25 C34 21 32 12 24 12Z" fill="${C.green}"/>` +
  `<path d="M24 47 L16 64 L24 58 L32 64Z" fill="${C.red}"/><circle cx="24" cy="20" r="5.2" fill="${C.green}" stroke="${C.white}" stroke-width="1"/>` +
  `<circle cx="22.4" cy="19" r="1.2" fill="${C.white}"/><path d="M26 21 L31 22.4 L26 24Z" fill="${C.red}"/>` +
  `<path d="M24 6 L21 12 M24 6 L27 12 M24 6 L24 11" stroke="${C.red}" stroke-width="1.6" stroke-linecap="round"/>` +
  `<ellipse cx="24" cy="36" rx="7" ry="9" fill="${C.blue}" opacity=".85"/><ellipse cx="24" cy="36" rx="3.4" ry="5" fill="${C.white}" opacity=".9"/>`;
const SOU = {
  1: bird,
  2: () => stick(24, 18, 24, 'green') + stick(24, 50, 24, 'blue'),
  3: () => stick(24, 18, 24, 'green') + stick(14, 50, 24, 'blue') + stick(34, 50, 24, 'blue'),
  4: () => stick(14, 18, 24, 'green') + stick(34, 18, 24, 'blue') + stick(14, 50, 24, 'blue') + stick(34, 50, 24, 'green'),
  5: (red) => stick(13, 17, 24, red ? 'red' : 'green') + stick(35, 17, 24, red ? 'red' : 'blue') + stick(13, 51, 24, red ? 'red' : 'blue') + stick(35, 51, 24, red ? 'red' : 'green') + stick(24, 34, 24, 'red'),
  6: () => [12, 24, 36].map(x => stick(x, 18, 24, 'green') + stick(x, 50, 24, 'green')).join(''),
  7: () => stick(24, 12, 18, 'red') + [12, 24, 36].map(x => stick(x, 36, 20, 'green') + stick(x, 58, 20, 'green')).join(''),
  8: () => [8.5, 19, 29, 39.5].map(x => stick(x, 18, 24, 'green', 7) + stick(x, 50, 24, 'green', 7)).join(''),
  9: () => [12, 24, 36].map(x => stick(x, 14, 18, 'green') + stick(x, 34, 18, 'red') + stick(x, 54, 18, 'blue')).join(''),
};

function face(kind, red) {
  if (kind < 9) {
    const n = kind % 9;
    return `<text x="24" y="30" text-anchor="middle" font-size="27" font-weight="900" fill="${red && n === 4 ? C.red : C.ink}" font-family="${FONT}">${NUM[n]}</text>` +
      `<text x="24" y="58" text-anchor="middle" font-size="25" font-weight="900" fill="${C.red}" font-family="${FONT}">萬</text>`;
  }
  if (kind < 18) return PIN[kind - 8](red);
  if (kind < 27) return SOU[kind - 17](red);
  const h = kind - 27, ch = HON[h];
  if (h === 4) return ''; // 백: 완전 백지
  const col = h === 5 ? C.green : h === 6 ? C.red : C.ink;
  return `<text x="24" y="47" text-anchor="middle" font-size="40" font-weight="900" fill="${col}" font-family="${FONT}">${ch}</text>`;
}

const svgCache = new Map();
function legacySVG(kind, red = false) {
  const key = kind * 2 + (red ? 1 : 0);
  let s = svgCache.get(key);
  if (!s) { s = `<svg viewBox="0 0 48 68" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${face(kind, red)}</svg>`; svgCache.set(key, s); }
  return s;
}

// 크기 클래스: t-hand / t-meld / t-river / t-dora / t-xs  (CSS에서 --tw 지정)
export function tileEl(kind, { red = false, cls = '' } = {}) {
  const d = document.createElement('div');
  d.className = 'tile ' + cls + (red ? ' red' : '');
  d.dataset.kind = kind;
  d.innerHTML = tileSVG(kind, red);
  return d;
}
export function backEl(cls = '') {
  const d = document.createElement('div');
  d.className = 'tile back ' + cls;
  return d;
}
export const WIND_KIND = [27, 28, 29, 30];

// ---- 패면 선택: 기본은 libreriichi 개별 SVG(CC0), ?tiles=old 면 아래의 직접 그린 SVG ----
const OLD = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tiles') === 'old';
const libreName = (kind, red) => kind >= 27 ? 'z' + (kind - 26) : 'mps'[Math.floor(kind / 9)] + (red ? 0 : (kind % 9) + 1);
export function tileSVG(kind, red = false) {
  return OLD ? legacySVG(kind, red) : `<img src="tiles/libre/${libreName(kind, red)}.svg" alt="" draggable="false">`;
}
