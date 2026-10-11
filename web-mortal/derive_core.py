"""upstream libriichi -> web-mortal/wasm-core/src 로 필요한 모듈만 복사하고 PyO3 어노테이션을 제거한다.

wasm-core/src 의 나머지(lib.rs, wasm.rs)와 일부 수작업 패치는 이 스크립트가 건드리지 않는다.
재실행하면 복사본이 덮어써지므로 수작업 패치는 PATCHES.md 참고.
"""
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / 'ai' / 'Mortal-S42' / 'runtime' / 'libriichi' / 'src'
DST = HERE / 'wasm-core' / 'src'

FILES = ['array.rs', 'chi_type.rs', 'consts.rs', 'hand.rs', 'macros.rs', 'tile.rs', 'vec_ops.rs',
         'rankings.rs', 'mjai/event.rs', 'mjai/mod.rs']
DIRS = ['algo', 'state']
DROP = ['state/test.rs']

DST.mkdir(parents=True, exist_ok=True)
(DST / 'mjai').mkdir(exist_ok=True)
for f in FILES:
    shutil.copy(SRC / f, DST / f)
for d in DIRS:
    shutil.copytree(SRC / d, DST / d, dirs_exist_ok=True)
for f in DROP:
    (DST / f).unlink(missing_ok=True)

ATTR = re.compile(r'^[ \t]*#\[(pyclass|pymethods|pyfunction|new|staticmethod|getter)\]\r?\n', re.M)
PYO3_ATTR = re.compile(r'^[ \t]*#\[pyo3\([^\r\n]*\)\]\r?\n', re.M)
USES = re.compile(r'^use (pyo3::prelude::\*|crate::py_helper::add_submodule);\r?\n', re.M)

REGISTER = re.compile(r'^pub\(crate\) fn register_module\(.*?^\}\r?\n', re.M | re.S)
ENCODE_PY = re.compile(r'^impl PlayerState \{\r?\n    /// Returns `\(obs, mask\)`\r?\n    fn encode_obs_py.*?^\}\r?\n\r?\n', re.M | re.S)
LITERAL = {  # (파일, 원문, 대체)
    'state/obs_repr.rs': [('use numpy::{PyArray1, PyArray2};\n', '')],
    'mjai/mod.rs': [('mod bot;\n', ''), ('use bot::Bot;\n', '')],
}

for p in DST.rglob('*.rs'):
    t = p.read_text(encoding='utf-8')
    n = USES.sub('', PYO3_ATTR.sub('', ATTR.sub('', t)))
    n = ENCODE_PY.sub('', REGISTER.sub('', n))
    for old, new in LITERAL.get(p.relative_to(DST).as_posix(), []):
        n = n.replace(old, new)
    if n != t:
        p.write_text(n, encoding='utf-8', newline='')
        print('patched', p.relative_to(DST))
