"""Mortal ONNX 양자화 실험: fp16(저장) / int8(dynamic, static+천봉 로그 보정) 변형을 만들고
천봉 평가셋(보정셋과 다른 대국)에서 fp32 원본 대비 Q값 오차를 잰다.

사용: ai/.venv/Scripts/python web-mortal/quantize.py [변형이름 ...]   (생략하면 전부)
출력: out/quant/<변형>.onnx, out/quant/results.json, 표(stdout)
"""
import gzip
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
import onnxruntime as ort
from onnxruntime.quantization import (CalibrationDataReader, CalibrationMethod, QuantFormat, QuantType,
                                      quantize_dynamic, quantize_static, quant_pre_process)

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out'
QDIR = OUT / 'quant'
QDIR.mkdir(exist_ok=True)
DATA = OUT / 'data'
BASE = OUT / 'mortal.onnx'
OBS_LEN, ACTIONS = 1012 * 34, 46
CALIB_N = 512  # 보정에 쓰는 샘플 수 (calib 셋 앞부분)


def load_set(name):
    meta = json.loads((DATA / f'{name}.json').read_text())
    n = meta['n']
    obs = np.memmap(DATA / f'{name}.obs.f32', dtype=np.float32, mode='r', shape=(n, 1012, 34))
    mask = np.fromfile(DATA / f'{name}.mask.u8', dtype=np.uint8).reshape(n, ACTIONS).astype(bool)
    return obs, mask


def session(path, threads=0):
    so = ort.SessionOptions()
    if threads:
        so.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), so, providers=['CPUExecutionProvider'])


def run_q(path, obs, mask, bs=32):
    sess = session(path)
    out = np.empty((len(obs), ACTIONS), dtype=np.float32)
    t = time.perf_counter()
    for i in range(0, len(obs), bs):
        out[i:i + bs] = sess.run(['q'], {'obs': np.ascontiguousarray(obs[i:i + bs]), 'mask': mask[i:i + bs]})[0]
    return out, (time.perf_counter() - t) / len(obs) * 1000


# ---------------- 변형 만들기 ----------------

def make_fp16_storage(src, dst, min_elems=1024):
    """큰 float32 가중치를 fp16으로 저장하고, 그래프 앞에 Cast(→fp32)를 넣는다 (연산은 fp32 그대로)."""
    m = onnx.load(str(src))
    g = m.graph
    inputs = {i.name for i in g.input}
    casts, keep = [], []
    for init in g.initializer:
        if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= min_elems and init.name not in inputs:
            arr = numpy_helper.to_array(init).astype(np.float16)
            half = numpy_helper.from_array(arr, init.name + '__fp16')
            keep.append(half)
            casts.append(helper.make_node('Cast', [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
        else:
            keep.append(init)
    del g.initializer[:]
    g.initializer.extend(keep)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    onnx.save(m, str(dst))


def preprocessed():
    p = QDIR / 'pre.onnx'
    if not p.exists():
        quant_pre_process(str(BASE), str(p), skip_symbolic_shape=True)
    return p


class Reader(CalibrationDataReader):
    def __init__(self, obs, mask, bs=16):
        self.obs, self.mask, self.bs, self.i = obs, mask, bs, 0

    def get_next(self):
        if self.i >= len(self.obs):
            return None
        s = slice(self.i, self.i + self.bs)
        self.i += self.bs
        return {'obs': np.ascontiguousarray(self.obs[s]), 'mask': self.mask[s]}


def node_names(model_path):
    m = onnx.load(str(model_path))
    convs = [n.name for n in m.graph.node if n.op_type == 'Conv']
    gemms = [n.name for n in m.graph.node if n.op_type == 'Gemm']
    return convs, gemms


def make_dynamic(dst, ops):
    quantize_dynamic(str(preprocessed()), str(dst), weight_type=QuantType.QInt8, op_types_to_quantize=ops,
                     per_channel=True)


def make_static(dst, ops, method, exclude_edges=False, percentile=99.999, qdq=True):
    pre = preprocessed()
    convs, gemms = node_names(pre)
    exclude = []
    if exclude_edges:
        exclude = [convs[0], gemms[-1]]  # 입력 첫 conv(1012ch)와 마지막 선형(Q head)
    obs, mask = load_set('calib')
    extra = {'ActivationSymmetric': False, 'WeightSymmetric': True}
    if method == CalibrationMethod.Percentile:
        extra['CalibPercentile'] = percentile
    quantize_static(str(pre), str(dst), Reader(obs[:CALIB_N], mask[:CALIB_N]),
                    quant_format=QuantFormat.QDQ if qdq else QuantFormat.QOperator,
                    per_channel=True, weight_type=QuantType.QInt8, activation_type=QuantType.QUInt8,
                    op_types_to_quantize=ops, nodes_to_exclude=exclude, calibrate_method=method,
                    extra_options=extra)


MM, PC, EN = CalibrationMethod.MinMax, CalibrationMethod.Percentile, CalibrationMethod.Entropy
VARIANTS = {
    'fp16': lambda d: make_fp16_storage(BASE, d),
    'int8-dyn-conv+gemm': lambda d: make_dynamic(d, ['Conv', 'Gemm']),
    'int8-dyn-conv': lambda d: make_dynamic(d, ['Conv']),
    'int8-st-minmax-all': lambda d: make_static(d, ['Conv', 'Gemm'], MM),
    'int8-st-minmax-conv': lambda d: make_static(d, ['Conv'], MM),
    'int8-st-minmax-conv-edge': lambda d: make_static(d, ['Conv'], MM, exclude_edges=True),
    'int8-st-pct-conv': lambda d: make_static(d, ['Conv'], PC),
    'int8-st-pct-conv-edge': lambda d: make_static(d, ['Conv'], PC, exclude_edges=True),
    'int8-st-entropy-conv-edge': lambda d: make_static(d, ['Conv'], EN, exclude_edges=True),
    # 하이브리드: int8로 양자화된 conv + 남은 fp32 가중치(첫 conv, Gemm 등)는 fp16 저장
    'int8-conv-edge+fp16': lambda d: make_fp16_storage(QDIR / 'int8-st-minmax-conv-edge.onnx', d),
    'int8-conv+fp16': lambda d: make_fp16_storage(QDIR / 'int8-st-minmax-conv.onnx', d),
    'int8-all+fp16': lambda d: make_fp16_storage(QDIR / 'int8-st-minmax-all.onnx', d),
}


# ---------------- 평가 ----------------

def softmax_legal(q, m):
    z = np.where(m, q, -np.inf)
    z = z - z.max(-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(-1, keepdims=True)


def metrics(qt, qs, m):
    """qt: 원본(teacher) Q, qs: 변형 Q, m: 합법 마스크. 합법 행동이 2개 이상인 '실제 선택' 지점만 평가."""
    multi = m.sum(-1) >= 2
    qt, qs, m = qt[multi], qs[multi], m[multi]
    d = np.where(m, np.abs(qt - qs), 0)
    at, as_ = np.where(m, qt, -np.inf).argmax(-1), np.where(m, qs, -np.inf).argmax(-1)
    rows = np.arange(len(qt))
    gap = qt[rows, at] - qt[rows, as_]  # 변형이 고른 수가 원본 최선보다 얼마나 낮은가(원본 Q 기준)
    pt, ps = softmax_legal(qt, m), softmax_legal(qs, m)
    kl = np.where(m, pt * (np.log(np.maximum(pt, 1e-12)) - np.log(np.maximum(ps, 1e-12))), 0).sum(-1)
    # 앱 채점과 직결되는 지표: 각 행동의 "자기 최선 대비 격차"(오프셋 V 이동은 상쇄됨)와 채점 구간(≤0.1 / ≤0.7 / 그 밖) 변동
    gt = qt.max(-1, keepdims=True) - qt
    gs = qs.max(-1, keepdims=True) - qs
    gd = np.where(m, np.abs(gt - gs), 0)
    bin_ = lambda g: np.digitize(g, [0.1000001, 0.7000001])  # noqa: E731
    flip = ((bin_(gt) != bin_(gs)) & m).sum() / m.sum()
    return {
        'gapdiff_mean': float(gd.sum() / m.sum()),
        'gapdiff_p99': float(np.percentile(gd[m], 99)),
        'bin_flip': float(flip),
        'n': int(multi.sum()),
        'max_dq': float(d.max()),
        'mean_dq': float(d.sum() / m.sum()),
        'p99_dq': float(np.percentile(d[m], 99)),
        'top1_agree': float((at == as_).mean()),
        'gap>0.1': float((gap > 0.1).mean()),
        'gap>0.7': float((gap > 0.7).mean()),
        'mean_prob_l1': float(np.abs(pt - ps).sum(-1).mean()),
        'kl': float(kl.mean()),
    }


def file_sizes(p):
    raw = p.read_bytes()
    return len(raw) / 1e6, len(gzip.compress(raw, 6)) / 1e6


def main():
    names = sys.argv[1:] or list(VARIANTS)
    obs, mask = load_set('eval')
    tq_path = QDIR / 'teacher_eval.npy'
    if tq_path.exists():
        tq, t_ms = np.load(tq_path), float('nan')
    else:
        tq, t_ms = run_q(BASE, obs, mask)
        np.save(tq_path, tq)
    res_path = QDIR / 'results.json'
    results = json.loads(res_path.read_text()) if res_path.exists() else {}
    for name in names:
        dst = QDIR / f'{name}.onnx'
        t0 = time.time()
        try:
            if not dst.exists():
                VARIANTS[name](dst)
            qs, ms = run_q(dst, obs, mask)
        except Exception as e:  # noqa: BLE001
            print(f'[{name}] 실패: {e!r}', flush=True)
            results[name] = {'error': repr(e)}
            res_path.write_text(json.dumps(results, indent=1))
            continue
        mb, gz = file_sizes(dst)
        results[name] = {'size_mb': round(mb, 1), 'gz_mb': round(gz, 1), 'py_ms_per_sample': round(ms, 1), **metrics(tq, qs, mask)}
        res_path.write_text(json.dumps(results, indent=1))
        print(f'[{name}] {time.time() - t0:.0f}s', json.dumps(results[name]), flush=True)
    print(f"\nbaseline fp32 size {file_sizes(BASE)[0]:.1f} MB / gz {file_sizes(BASE)[1]:.1f} MB")
    hdr = (f"{'variant':28} {'MB':>6} {'gzMB':>6} {'gapΔmean':>9} {'gapΔp99':>8} {'binflip':>8} {'top1':>6} "
           f"{'gap>.1':>7} {'gap>.7':>7} {'probL1':>8} {'KL':>8}")
    print(hdr)
    for k, v in results.items():
        if 'error' in v:
            print(f'{k:28} ERROR {v["error"][:80]}')
        else:
            print(f"{k:28} {v['size_mb']:6.1f} {v['gz_mb']:6.1f} {v['gapdiff_mean']:9.5f} {v['gapdiff_p99']:8.4f} {v['bin_flip']:8.5f} "
                  f"{v['top1_agree']:6.3f} {v['gap>0.1']:7.4f} {v['gap>0.7']:7.4f} {v['mean_prob_l1']:8.5f} {v['kl']:8.5f}")


if __name__ == '__main__':
    main()
