"""스타일 헤드 산출물 내보내기: style_final.npz → styles.json (메타·프로토타입) + styles.bin (가중치).
 styles.bin 배치(리틀 엔디언): U float32[k*46] → V float16[k*46*1024].   δ(phi, z) = Σ_k z_k (U_k + V_k·phi)
 공개 배포용이므로 선수 이름·선수별 z 는 넣지 않는다 (익명 군집 프로토타입만).
사용: ai/.venv/Scripts/python web-mortal/tools/export_styles.py [--src web-mortal/exp-data/style_final.npz] [--out web-mortal/out/styles]
"""
import json, sys
from pathlib import Path
import numpy as np

# 군집 표시 이름/설명: exp/cluster_profile.py 의 실제 행동 분석(실제 − Mortal 기대)에서 직접 나온 서술. 군집 번호는 style_final.npz 기준.
NAMES = {
    0: ('표준형', 'Mortal 과 거의 같은 경향 (가장 큰 그룹)'),
    1: ('신중형', '초반 자패를 남기고 노두패를 먼저 버리며, 리치·부름도 Mortal 보다 아끼는 경향'),
    2: ('효율형', '자패를 먼저 정리하고 중장패를 지키며, 리치·부름이 조금 적극적인 경향'),
}
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
src, out = Path(arg('--src', 'web-mortal/exp-data/style_final.npz')), Path(arg('--out', 'web-mortal/out/styles'))
d = np.load(src, allow_pickle=True)
k, S = int(d['k']), len(d['centroids'])
U = d['U'].astype(np.float32); V = d['V'].astype(np.float16)
assert U.shape == (k, 46) and V.shape == (k, 46, 1024)
out.mkdir(parents=True, exist_ok=True)
(out / 'styles.bin').write_bytes(U.astype('<f4').tobytes() + V.astype('<f2').tobytes())
meta = {
    'format': 1, 'k': k, 'actions': 46, 'phi': 1024, 'temperature': 1.0,
    'layout': 'U float32[k*46] then V float16[k*46*1024], little-endian',
    'trained_on': {'players': int(len(d['players'])), 'note': '명인전 + 천봉위 대국으로 학습 (대국 데이터 자체는 포함하지 않음)'},
    'eval': {'test_logp_base': float(d['base_ll']), 'test_logp_style': float(d['test_ll'])},
    'styles': [{'id': f'style-{j}', 'name': NAMES.get(j, (f'스타일 {j}', ''))[0], 'desc': NAMES.get(j, (f'스타일 {j}', ''))[1], 'z': [round(float(x), 6) for x in d['centroids'][j]], 'members': int((d['labels'] == j).sum())} for j in range(S)],
}
(out / 'styles.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf8')
print(f'저장: {out}/styles.json, styles.bin ({(out / "styles.bin").stat().st_size / 1e3:.0f}KB), 스타일 {S}개, k={k}')
