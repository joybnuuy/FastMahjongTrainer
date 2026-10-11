// 검증 측정값 (test/metric-compare.js, test/pushfold-tune.js 결과를 옮겨 적음). 해설 화면에 근거로 표시한다.
// 효율: Mortal 1순위와의 정확 일치율(%) — 효율 문제 n개
export const EFF_AGREE = { n: 264, random: 24.3, ukeire: 50.0, twoStep: 57.2, ev: 50.4 };
// 푸시/풀: 검증 구간에서 Mortal의 접기/밀기와 같은 방향이었던 비율(%). 아직 측정 전이면 null
export const PUSHFOLD_AGREE = { n: 109, model: 78.9, rule: 62.4, majority: 85.3, mcc: 0.33, pushHit: 9, pushTotal: 16 }; // 보정에 쓰지 않은 검증 구간 (test/pushfold-tune.js)
