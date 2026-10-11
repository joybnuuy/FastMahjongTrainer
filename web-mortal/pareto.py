"""민감도 순서대로 레이어를 fp16으로 되돌리며 실제 ORT static int8 양자화 → 크기 vs 오차 파레토.

사용: ai/.venv/Scripts/python web-mortal/pareto.py
의존: out/quant/sensitivity.json (sensitivity.py), out/data/{calib,eval}
각 변형 = [민감한 상위 k개 후보 레이어는 양자화 제외] + [CA-MLP 등 나머지 작은 Gemm은 항상 제외] → int8 QDQ → 남은 fp32는 fp16 저장.
"""
import json
import time
from pathlib import Path

import numpy as np
import onnx
from onnxruntime.quantization import CalibrationMethod, QuantFormat, QuantType, quantize_static

from quantize import (BASE, CALIB_N, QDIR, Reader, file_sizes, load_set, make_fp16_storage, metrics, run_q)

S = json.loads((QDIR / 'sensitivity.json').read_text())
names = S['names']
node_of = S['onnx_node']
order_abl = sorted(names, key=lambda n: -S['ablation'][n]['gapdiff_mean'])
order_fis = sorted(names, key=lambda n: -S['fisher_omega'][n])
order_depth = sorted(names, key=lambda n: ([int(t) for t in n.replace('.', ' ').split() if t.isdigit()] or [0])[0])  # 앞쪽 레이어부터(비교용)

pre = QDIR / 'pre.onnx'
pm = onnx.load(str(pre))
ALL_QOPS = [n.name for n in pm.graph.node if n.op_type in ('Conv', 'Gemm')]
CAND_NODES = set(node_of.values())
ALWAYS_EXCLUDE = [n for n in ALL_QOPS if n not in CAND_NODES]  # 채널어텐션 MLP 등 (크기 미미)


def build(tag, excluded_layers):
    dst = QDIR / f'par-{tag}.onnx'
    if dst.exists():
        return dst
    tmp = QDIR / f'par-{tag}.int8.onnx'
    obs, mask = load_set('calib')
    quantize_static(str(pre), str(tmp), Reader(obs[:CALIB_N], mask[:CALIB_N]), quant_format=QuantFormat.QDQ,
                    per_channel=True, weight_type=QuantType.QInt8, activation_type=QuantType.QUInt8,
                    op_types_to_quantize=['Conv', 'Gemm'],
                    nodes_to_exclude=ALWAYS_EXCLUDE + [node_of[n] for n in excluded_layers],
                    calibrate_method=CalibrationMethod.MinMax,
                    extra_options={'ActivationSymmetric': False, 'WeightSymmetric': True})
    make_fp16_storage(tmp, dst)
    tmp.unlink()
    return dst


def main():
    obs, mask = load_set('eval')
    tq = np.load(QDIR / 'teacher_eval.npy')
    res_p = QDIR / 'pareto.json'
    res = json.loads(res_p.read_text()) if res_p.exists() else {}
    plan = []
    for k in (0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48):
        plan.append((f'abl-k{k}', order_abl[:k]))
    for k in (1, 2, 4, 8, 16, 32):  # Fisher 순서는 실제로 예측력이 있는지 비교
        plan.append((f'fis-k{k}', order_fis[:k]))
    for k in (4, 16, 32):  # 대조군: 앞쪽 레이어부터 fp16으로 되돌림
        plan.append((f'depth-k{k}', order_depth[:k]))
    for tag, ex in plan:
        if tag in res:
            continue
        t0 = time.time()
        dst = build(tag, ex)
        qs, ms = run_q(dst, obs, mask)
        mb, gz = file_sizes(dst)
        res[tag] = {'k': len(ex), 'size_mb': round(mb, 1), 'gz_mb': round(gz, 1), **metrics(tq, qs, mask),
                    'fp16_layers': ex[:6]}
        res_p.write_text(json.dumps(res, indent=1))
        v = res[tag]
        print(f"[{tag}] {time.time() - t0:.0f}s {v['size_mb']}MB gapΔ={v['gapdiff_mean']:.5f} flip={v['bin_flip']:.5f} top1={v['top1_agree']:.4f}", flush=True)
    print(f"\n{'variant':12} {'k':>3} {'MB':>6} {'gzMB':>6} {'gapΔmean':>9} {'gapΔp99':>8} {'binflip':>8} {'top1':>6} {'loss>.1':>8}")
    for tag, v in sorted(res.items(), key=lambda kv: (kv[0].split('-')[0], kv[1]['k'])):
        print(f"{tag:12} {v['k']:3d} {v['size_mb']:6.1f} {v['gz_mb']:6.1f} {v['gapdiff_mean']:9.5f} {v['gapdiff_p99']:8.4f} "
              f"{v['bin_flip']:8.5f} {v['top1_agree']:6.4f} {v['gap>0.1']:8.4f}")


if __name__ == '__main__':
    main()
