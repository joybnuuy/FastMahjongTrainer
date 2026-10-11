// 공개 전 점검용 공통 도구. 개인 식별 문자열을 코드에 적지 않고 실행 시점에 시스템에서 가져온다.
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 사용자명, 홈 폴더 이름, git 전역 이메일, 그리고 환경변수 MJP_EXTRA_FORBIDDEN(쉼표 구분)에 적은 값을 공개물에서 찾는다.
export function personalPattern() {
  const names = new Set([os.userInfo().username, path.basename(os.homedir())]);
  try {
    const email = execSync('git config --global user.email', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (email) names.add(email);
  } catch { /* git 없음/미설정 */ }
  for (const x of (process.env.MJP_EXTRA_FORBIDDEN || '').split(',')) if (x.trim()) names.add(x.trim());
  const parts = [...names].filter(s => s && s.length >= 4).map(esc);
  return parts.length ? new RegExp(parts.join('|'), 'i') : null;
}
