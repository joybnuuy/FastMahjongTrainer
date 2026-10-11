"""가중치만 int8로 저장 (활성값은 fp32 계산). 가중치 initializer → int8 + per-channel scale + DequantizeLinear(constant-folded).
다운로드 크기가 목적이므로 활성 양자화(오차의 대부분)를 하지 않는다.

사용: ai/.venv/Scripts/python web-mortal/weight_only.py
출력: out/quant/wo-*.onnx, out/quant/wo-results.json
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import torch
from onnx import TensorProto, helper, numpy_helper

from export_onnx import load
from quantize import BASE, QDIR, file_sizes, load_set, make_fp16_storage, metrics, run_q
from qat import KEEP_FP, NAMES, S, dev, fq_weight, fwd, set_module

to_t = lambda a: torch.from_numpy(np.ascontiguousarray(a)).to(dev)  # noqa: E731


def make_weight_only(src, dst, layers):
    """layers: torch 모듈 이름 목록 → 해당 conv/gemm 가중치를 int8(per-out-channel 대칭)+DequantizeLinear로 교체한 뒤 나머지 fp32는 fp16 저장."""
    m = onnx.load(str(src))
    g = m.graph
    init = {i.name: i for i in g.initializer}
    node_by_name = {n.name: n for n in g.node}
    new_nodes, drop = [], set()
    for ln in layers:
        node = node_by_name[S['onnx_node'][ln]]
        wname = node.input[1]
        w = numpy_helper.to_array(init[wname]).astype(np.float32)
        s = np.maximum(np.abs(w.reshape(w.shape[0], -1)).max(1) / 127.0, 1e-12).astype(np.float32)
        q = np.clip(np.round(w / s.reshape(-1, *([1] * (w.ndim - 1)))), -127, 127).astype(np.int8)
        qn, sn = wname + '__q', wname + '__scale'
        g.initializer.extend([numpy_helper.from_array(q, qn), numpy_helper.from_array(s, sn)])
        new_nodes.append(helper.make_node('DequantizeLinear', [qn, sn], [wname], axis=0, name=wname + '__dq'))
        drop.add(wname)
    keep = [i for i in g.initializer if i.name not in drop]
    del g.initializer[:]
    g.initializer.extend(keep)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(new_nodes + nodes)
    tmp = Path(str(dst) + '.tmp')
    onnx.save(m, str(tmp))
    make_fp16_storage(tmp, dst)
    tmp.unlink()


def weight_only_sensitivity():
    """가중치만 int8로 했을 때 레이어별 gapΔ (ablation). 보정셋 [512,1536)에서."""
    net = load().to(dev).eval()
    mods = dict(net.named_modules())
    c_obs, c_mask = load_set('calib')
    o, mk = to_t(c_obs[512:1536]), to_t(c_mask[512:1536])
    qt = fwd(net, o, mk).cpu().numpy()
    mn = mk.cpu().numpy()
    out = {}
    for n in NAMES:
        w0 = mods[n].weight.data.clone()
        mods[n].weight.data = fq_weight(w0)
        qs = fwd(net, o, mk).cpu().numpy()
        mods[n].weight.data = w0
        out[n] = metrics(qt, qs, mn)['gapdiff_mean']
    return out


def main():
    obs, mask = load_set('eval')
    tq = np.load(QDIR / 'teacher_eval.npy')
    sens = weight_only_sensitivity()
    order = sorted(NAMES, key=lambda n: -sens[n])
    print('weight-only 민감도 상위:', [(n.replace('brain.encoder.', ''), round(sens[n], 5), S['params'][n]) for n in order[:6]], flush=True)
    print('합계', round(sum(sens.values()), 4), '(레이어 84개 단독 gapΔ 합)', flush=True)
    plan = [('wo-all', NAMES), ('wo-keep-old4', [n for n in NAMES if n not in KEEP_FP])]
    for k in (1, 2, 4, 8):
        plan.append((f'wo-keep-top{k}', [n for n in NAMES if n not in order[:k]]))
    res_p = QDIR / 'wo-results.json'
    res = {'weight_only_sensitivity': sens}
    for tag, layers in plan:
        dst = QDIR / f'{tag}.onnx'
        t0 = time.time()
        make_weight_only(BASE, dst, layers)
        qs, ms = run_q(dst, obs, mask)
        mb, gz = file_sizes(dst)
        res[tag] = {'int8_layers': len(layers), 'size_mb': round(mb, 1), 'gz_mb': round(gz, 1), **metrics(tq, qs, mask)}
        res_p.write_text(json.dumps(res, indent=1))
        v = res[tag]
        print(f"[{tag}] {time.time() - t0:.0f}s {v['size_mb']}MB gapΔ={v['gapdiff_mean']:.5f} p99={v['gapdiff_p99']:.4f} flip={v['bin_flip']:.5f} top1={v['top1_agree']:.4f} loss>.1={v['gap>0.1']:.4f}", flush=True)


if __name__ == '__main__':
    main()
