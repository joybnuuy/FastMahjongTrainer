"""레이어별 int8 민감도 분석 (PyTorch, GPU).

후보 레이어 = 모든 Conv1d(82) + 큰 선형 2개(encoder 끝 1088->1024, dqn 1024->47).  (채널어텐션 MLP는 크기가 미미해 항상 fp16/fp32)
두 가지 척도:
  A) ablation : 한 레이어만 int8(가중치 per-channel 대칭 + 입력 활성 uint8 minmax)로 시뮬레이션하고 fp32 대비 격차 오차(gapΔ)를 잼
  B) fisher   : 모델 자신의 정책 softmax(Q)에서 행동을 샘플해 -log p 의 가중치 기울기^2 를 누적한 경험적 Fisher 대각 F,
                Ω_L = Σ F * (W_q - W)^2  (양자화가 손실을 올리는 양의 2차 근사, HAWQ 계열)
데이터: 천봉 보정셋(calib)에서 [0,512)=활성 범위 보정, [512,1536)=민감도 측정. 평가셋(eval)은 건드리지 않는다.
출력: out/quant/sensitivity.json
"""
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import torch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from export_onnx import load  # noqa: E402
from quantize import load_set, metrics, QDIR  # noqa: E402

dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
N_RANGE, N_SENS, N_FISHER = 512, 1024, 384


def onnx_to_torch_name(node_name):
    segs = node_name.strip('/').split('/')[:-1]  # 마지막은 op 이름
    out = []
    for s in segs:
        if out and s.startswith(out[-1] + '.'):
            out[-1] = s
        else:
            out.append(s)
    return '.'.join(out)


def candidates(net):
    """{torch모듈이름: onnx노드이름}  (pre.onnx 기준) — Conv 전부 + 큰 Gemm"""
    m = onnx.load(str(QDIR / 'pre.onnx'))
    init = {i.name: i for i in m.graph.initializer}
    mods = dict(net.named_modules())
    res = {}
    for n in m.graph.node:
        if n.op_type == 'Conv' or (n.op_type == 'Gemm' and np.prod(init[n.input[1]].dims) > 5000):
            tn = onnx_to_torch_name(n.name)
            assert tn in mods, (n.name, tn)
            res[tn] = n.name
    return res, mods


def fq_weight(w):
    """per-output-channel 대칭 int8 fake-quant."""
    flat = w.reshape(w.shape[0], -1)
    s = (flat.abs().amax(1) / 127.0).clamp_min(1e-12).view(-1, *([1] * (w.dim() - 1)))
    return (w / s).round().clamp(-127, 127) * s


def fq_act(x, lo, hi):
    """per-tensor 비대칭 uint8 fake-quant (0 포함 범위)."""
    lo, hi = min(lo, 0.0), max(hi, 0.0)
    s = max((hi - lo) / 255.0, 1e-12)
    zp = round(-lo / s)
    return ((x / s).round() + zp).clamp(0, 255).sub(zp).mul(s)


@torch.no_grad()
def forward_q(net, obs, mask, bs=128):
    out = []
    for i in range(0, len(obs), bs):
        out.append(net(obs[i:i + bs], mask[i:i + bs]))
    return torch.cat(out)


def main():
    t0 = time.time()
    net = load().to(dev).eval()
    cand, mods = candidates(net)
    names = list(cand)
    print(f'device={dev} candidates={len(names)} (conv={sum(isinstance(mods[n], torch.nn.Conv1d) for n in names)})', flush=True)

    obs_all, mask_all = load_set('calib')
    to_t = lambda a: torch.from_numpy(np.ascontiguousarray(a)).to(dev)  # noqa: E731
    obs_r, mask_r = to_t(obs_all[:N_RANGE]), to_t(mask_all[:N_RANGE])
    obs_s, mask_s = to_t(obs_all[N_RANGE:N_RANGE + N_SENS]), to_t(mask_all[N_RANGE:N_RANGE + N_SENS])

    # 활성 범위 보정 (각 후보 레이어 입력의 min/max)
    ranges = {}
    hooks = []
    for n in names:
        def hk(mod, inp, n=n):
            x = inp[0]
            lo, hi = float(x.min()), float(x.max())
            a = ranges.get(n, (lo, hi))
            ranges[n] = (min(a[0], lo), max(a[1], hi))
        hooks.append(mods[n].register_forward_pre_hook(hk))
    forward_q(net, obs_r, mask_r)
    for h in hooks:
        h.remove()

    qt = forward_q(net, obs_s, mask_s)
    qt_np, m_np = qt.cpu().numpy(), mask_s.cpu().numpy()

    # ---- A) ablation ----
    abl = {}
    for n in names:
        mod = mods[n]
        w0 = mod.weight.data.clone()
        mod.weight.data = fq_weight(w0)
        lo, hi = ranges[n]
        h = mod.register_forward_pre_hook(lambda mm, inp, lo=lo, hi=hi: (fq_act(inp[0], lo, hi),))
        qs = forward_q(net, obs_s, mask_s).cpu().numpy()
        h.remove()
        mod.weight.data = w0
        mt = metrics(qt_np, qs, m_np)
        abl[n] = {k: mt[k] for k in ('gapdiff_mean', 'gapdiff_p99', 'bin_flip', 'top1_agree', 'kl')}
    print(f'ablation done {time.time() - t0:.0f}s', flush=True)

    # ---- B) 경험적 Fisher (모델 자신의 정책에서 샘플한 행동) ----
    for p in net.parameters():
        p.requires_grad_(False)
    fisher = {n: torch.zeros_like(mods[n].weight) for n in names}
    for n in names:
        mods[n].weight.requires_grad_(True)
    g = torch.Generator(device=dev).manual_seed(0)
    # 학습 시점 아님: BN은 eval 유지, 입력 obs에는 grad 불필요
    for i in range(N_FISHER):
        o, mk = obs_s[i:i + 1], mask_s[i:i + 1]
        q = net(o, mk)
        logp = torch.log_softmax(q, -1)
        a = torch.multinomial(logp.exp().detach().clamp_min(0), 1, generator=g)
        loss = -logp.gather(1, a).sum()
        grads = torch.autograd.grad(loss, [mods[n].weight for n in names])
        for n, gr in zip(names, grads):
            fisher[n] += gr.detach() ** 2
    fis = {}
    for n in names:
        w = mods[n].weight.data
        dw = fq_weight(w) - w
        fis[n] = float((fisher[n] / N_FISHER * dw ** 2).sum())
    print(f'fisher done {time.time() - t0:.0f}s', flush=True)

    # 순위 상관 (Spearman)
    a_rank = np.argsort(np.argsort([-abl[n]['gapdiff_mean'] for n in names]))
    f_rank = np.argsort(np.argsort([-fis[n] for n in names]))
    rho = float(np.corrcoef(a_rank, f_rank)[0, 1])
    size = {n: int(mods[n].weight.numel()) for n in names}
    out = {'names': names, 'onnx_node': cand, 'params': size, 'ablation': abl, 'fisher_omega': fis,
           'spearman_ablation_vs_fisher': rho, 'n_sens': N_SENS, 'n_fisher': N_FISHER}
    (QDIR / 'sensitivity.json').write_text(json.dumps(out, indent=1))

    print(f'\nSpearman(ablation, fisher) = {rho:.3f}')
    order = sorted(names, key=lambda n: -abl[n]['gapdiff_mean'])
    print(f"{'layer':44} {'params':>8} {'abl gapΔ':>9} {'abl flip':>9} {'fisherΩ':>10}")
    for n in order[:14] + ['...'] + order[-4:]:
        if n == '...':
            print('...')
            continue
        print(f"{n:44} {size[n]:8d} {abl[n]['gapdiff_mean']:9.5f} {abl[n]['bin_flip']:9.5f} {fis[n]:10.3e}")
    print('합계(모든 레이어 개별 gapΔ 합) =', round(sum(v['gapdiff_mean'] for v in abl.values()), 4))


if __name__ == '__main__':
    main()
