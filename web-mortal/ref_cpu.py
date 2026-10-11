"""out/req/<id>.json(test_e2e.mjs가 덤프)을 Python Mortal(CPU, fp32)로 분석해 <id>.cpu.json 으로 저장."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'ai'))
sys.path.insert(0, str(HERE.parent / 'ai' / 'Mortal-S42'))
from inference import load_engine  # noqa: E402
import analyze as A  # noqa: E402

engine = load_engine('cpu')
for f in sorted((HERE / 'out' / 'req').glob('*.json')):
    if f.name.endswith('.cpu.json'):
        continue
    out = f.with_name(f.stem + '.cpu.json')
    if out.exists():
        continue
    d = json.loads(f.read_text(encoding='utf-8'))
    res = A.analyze(engine, d['events'], d['requests'])
    for r in res:
        r['mask'] = str(r['mask']) if r['mask'] is not None else None
        if r['reach']:
            r['reach']['mask'] = str(r['reach']['mask'])
    out.write_text(json.dumps(res), encoding='utf-8')
    print(f.stem, len(res), flush=True)
