"""Mortal-S42 (Brain v4 + DQN v4) -> ONNX 내보내기 + PyTorch 패리티 검증.

사용: ai/.venv/Scripts/python web-mortal/export_onnx.py
출력: web-mortal/out/mortal.onnx (+ 필요 시 mortal.fp16.onnx)
입력: obs float32 (N,1012,34), mask bool (N,46)  ->  q float32 (N,46)  (불가능 행동은 -inf)
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / 'ai' / 'Mortal-S42'
OUT = HERE / 'out'
OUT.mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT / 'runtime' / 'mortal'))
from model import Brain, DQN  # noqa: E402


class Net(torch.nn.Module):
    def __init__(self, brain, dqn):
        super().__init__()
        self.brain, self.dqn = brain, dqn

    def forward(self, obs, mask):
        return self.dqn(self.brain(obs), mask)


def load():
    ident = json.loads((ROOT / 'model-identity.json').read_text())
    ckpt = ROOT / ident['file']
    assert hashlib.sha256(ckpt.read_bytes()).hexdigest() == ident['sha256'], 'checksum mismatch'
    state = torch.load(ckpt, map_location='cpu', weights_only=True)
    brain = Brain(version=4, conv_channels=192, num_blocks=40).eval()
    dqn = DQN(version=4).eval()
    brain.load_state_dict(state['mortal'], strict=True)
    dqn.load_state_dict(state['current_dqn'], strict=True)
    return Net(brain, dqn).eval()


def sample_inputs(n, seed=0):
    g = np.random.default_rng(seed)
    obs = (g.random((n, 1012, 34)) < 0.15).astype(np.float32)
    mask = g.random((n, 46)) < 0.3
    mask[:, 45] = True  # 최소 하나는 합법
    return obs, mask


def main():
    net = load()
    obs, mask = sample_inputs(4)
    path = OUT / 'mortal.onnx'
    torch.onnx.export(
        net, (torch.from_numpy(obs), torch.from_numpy(mask)), str(path),
        input_names=['obs', 'mask'], output_names=['q'],
        dynamic_axes={'obs': {0: 'n'}, 'mask': {0: 'n'}, 'q': {0: 'n'}},
        opset_version=17, dynamo=False,
    )
    print('exported', path, f'{path.stat().st_size / 1e6:.1f} MB')

    import onnxruntime as ort
    sess = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    worst = 0.0
    for seed in range(3):
        o, m = sample_inputs(3, seed + 10)
        with torch.inference_mode():
            ref = net(torch.from_numpy(o), torch.from_numpy(m)).numpy()
        got = sess.run(['q'], {'obs': o, 'mask': m})[0]
        assert np.array_equal(np.isneginf(ref), np.isneginf(got)), 'mask(-inf) mismatch'
        fin = np.isfinite(ref)
        worst = max(worst, float(np.abs(ref[fin] - got[fin]).max()))
        assert (ref.argmax(-1) == got.argmax(-1)).all(), 'argmax mismatch'
    print('parity OK, max |dq| =', worst)


if __name__ == '__main__':
    main()
