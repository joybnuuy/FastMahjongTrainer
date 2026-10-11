"""Mortal-S42 분석 워커 (stdin/stdout JSON lines).

요청:  {"id": "...", "events": [mjai 전체정보 이벤트...], "requests": [{"seat": 0, "idx": 123}, ...]}
        idx = 판단이 필요한 시점의 mjai 이벤트 인덱스 (보통 해당 플레이어의 tsumo)
응답:  {"id": "...", "results": [{"seat","idx","type","q","mask","reach":{"q","mask"}|null}, ...]}
        q = mask 비트가 켜진 합법 행동들의 Q값 (오름차순 행동 인덱스 순서)

행동 인덱스: 0-33 타패, 34-36 적5 타패(만/통/삭), 37 리치, 38-40 치, 41 퐁, 42 깡, 43 화료, 44 구종구패, 45 패스
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'Mortal-S42'
sys.path.insert(0, str(ROOT))
from inference import load_engine  # noqa: E402
from libriichi.mjai import Bot  # noqa: E402

DEVICE = 'cuda'
try:
    import torch
    if not torch.cuda.is_available():
        DEVICE = 'cpu'
except Exception:
    DEVICE = 'cpu'


def view_for(events, seat):
    """해당 좌석에게 보이지 않는 정보(타가 손패/쯔모)를 '?'로 가린다."""
    out = []
    for ev in events:
        t = ev['type']
        if t == 'start_kyoku':
            ev = dict(ev, tehais=[h if i == seat else ['?'] * 13 for i, h in enumerate(ev['tehais'])])
        elif t == 'tsumo' and ev['actor'] != seat:
            ev = dict(ev, pai='?')
        out.append(json.dumps(ev))
    return out


def pack(reaction):
    meta = (reaction or {}).get('meta') or {}
    return {'type': (reaction or {}).get('type'), 'pai': (reaction or {}).get('pai'),
            'q': meta.get('q_values'), 'mask': meta.get('mask_bits')}


def analyze(engine, events, requests):
    by_seat = {}
    for r in requests:
        by_seat.setdefault(r['seat'], []).append(r['idx'])
    results = []
    for seat, idxs in by_seat.items():
        lines = view_for(events, seat)
        want = set(idxs)
        bot = Bot(engine, seat)
        got = {}
        for i, line in enumerate(lines):
            reaction = bot.react(line, can_act=i in want)
            if i in want:
                got[i] = json.loads(reaction) if reaction else None
        for idx in idxs:
            res = {'seat': seat, 'idx': idx, **pack(got.get(idx)), 'reach': None}
            if res['mask'] is not None and (res['mask'] >> 37) & 1:
                # 리치를 선언했을 때의 타패 분포: 새 봇을 같은 지점까지 재생한 뒤 reach 이벤트 주입
                fork = Bot(engine, seat)
                for i in range(idx + 1):
                    fork.react(lines[i], can_act=False)
                rr = fork.react(json.dumps({'type': 'reach', 'actor': seat}), can_act=True)
                if rr:
                    p = pack(json.loads(rr))
                    res['reach'] = {'q': p['q'], 'mask': p['mask']}
            results.append(res)
    return results


def main():
    engine = load_engine(DEVICE)
    print(json.dumps({'ready': True, 'device': DEVICE}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            out = {'id': req.get('id'), 'results': analyze(engine, req['events'], req['requests'])}
        except Exception as e:  # noqa: BLE001
            out = {'id': req.get('id'), 'error': repr(e)}
        print(json.dumps(out), flush=True)


if __name__ == '__main__':
    main()
