"""int8 오차가 가중치 양자화 때문인지, 활성값(minmax 범위) 양자화 때문인지 분해한다 (fake-quant 시뮬레이션, 민감 상위 4개 제외 80 conv).
사용: ai/.venv/Scripts/python web-mortal/diag_error_source.py
"""
import numpy as np
import torch
import torch.nn.functional as F

from export_onnx import load
from qat import QUANT, calibrate_ranges, fq_act, fq_weight, fwd, rng_of, set_module, dev
from quantize import load_set, metrics

to_t = lambda a: torch.from_numpy(np.ascontiguousarray(a)).to(dev)  # noqa: E731


class QC(torch.nn.Module):
    def __init__(self, conv, in_rng, out_rng, w=True, ain=True, aout=True):
        super().__init__()
        self.conv, self.in_rng, self.out_rng, self.w, self.ain, self.aout = conv, in_rng, out_rng, w, ain, aout

    def forward(self, x):
        if self.ain:
            x = fq_act(x, *self.in_rng)
        wt = fq_weight(self.conv.weight) if self.w else self.conv.weight
        y = F.conv1d(x, wt, self.conv.bias, self.conv.stride, self.conv.padding)
        return fq_act(y, *self.out_rng) if self.aout else y


@torch.no_grad()
def percentile_ranges(net, obs, mask, pct):
    mods = dict(net.named_modules())
    buf, hooks = {}, []
    for n in QUANT:
        def hk(m, inp, out, n=n):
            b = buf.setdefault(n, [[], []])
            b[0].append(inp[0].flatten()[::7].cpu())
            b[1].append(out.flatten()[::7].cpu())
        hooks.append(mods[n].register_forward_hook(hk))
    fwd(net, obs, mask)
    for h in hooks:
        h.remove()
    res = {}
    for n, (i, o) in buf.items():
        i, o = torch.cat(i).numpy(), torch.cat(o).numpy()
        res[n] = (rng_of(float(np.percentile(i, 100 - pct)), float(np.percentile(i, pct))),
                  rng_of(float(np.percentile(o, 100 - pct)), float(np.percentile(o, pct))))
    return res


def run(label, ranges, **flags):
    net = load().to(dev).eval()
    mods = dict(net.named_modules())
    for n in QUANT:
        set_module(net, n, QC(mods[n], *ranges[n], **flags))
    qs = fwd(net, val_obs, val_mask).cpu().numpy()
    m = metrics(val_qt, qs, val_m)
    print(f"{label:46} gapΔ={m['gapdiff_mean']:.5f} p99={m['gapdiff_p99']:.4f} flip={m['bin_flip']:.5f} top1={m['top1_agree']:.4f}", flush=True)


c_obs, c_mask = load_set('calib')
teacher = load().to(dev).eval()
rng_ref = calibrate_ranges(load().to(dev).eval(), to_t(c_obs[:512]), to_t(c_mask[:512]))
val_obs, val_mask = to_t(c_obs[1536:]), to_t(c_mask[1536:])
val_qt = fwd(teacher, val_obs, val_mask).cpu().numpy()
val_m = val_mask.cpu().numpy()

print('--- 오차 원천 분해 (minmax 활성 범위) ---')
run('가중치만 int8', rng_ref, w=True, ain=False, aout=False)
run('활성 입력만 uint8', rng_ref, w=False, ain=True, aout=False)
run('활성 출력만 uint8', rng_ref, w=False, ain=False, aout=True)
run('활성 입출력 uint8 (가중치 fp)', rng_ref, w=False)
run('전부 (현재 PTQ와 같은 조건)', rng_ref)
print('--- 활성 범위를 percentile로 자르면? (전부 양자화) ---')
for pct in (99.999, 99.99, 99.9):
    pr = percentile_ranges(load().to(dev).eval(), to_t(c_obs[:512]), to_t(c_mask[:512]), pct)
    run(f'percentile {pct}', pr)
