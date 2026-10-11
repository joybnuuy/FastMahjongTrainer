"""QAT + 증류 (1단계: 사람 라벨 없음).

교사 = fp32 Mortal-S42, 학생 = 같은 모델에서 시작해 민감도 하위 80개 conv를 int8 fake-quant(입력/출력 활성 uint8 + 가중치 per-channel int8, STE)로
감싼 채 교사의 Q(격차)를 따라가도록 미세조정. 민감 상위 4개(net.43, net.0, net.46, dqn.net)는 fp 그대로.
학습 후: fake-quant를 걷어낸 가중치를 ONNX로 내보내 기존 PTQ 파이프라인(ORT static, MinMax 보정)으로 int8화 → fp16 저장 → 평가셋에서 측정.

사용: ai/.venv/Scripts/python web-mortal/qat.py [--steps 4000] [--lr 3e-5] [--tag qat1]
데이터: train(학습, calib/eval과 대국 분리), calib[0:512](활성 범위), calib[1536:](검증 모니터링), eval(최종 측정만)
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import onnx
import torch
import torch.nn.functional as F
from onnxruntime.quantization import CalibrationMethod, QuantFormat, QuantType, quant_pre_process, quantize_static

from export_onnx import load
from quantize import CALIB_N, DATA, QDIR, Reader, file_sizes, load_set, make_fp16_storage, metrics, run_q
from sensitivity import onnx_to_torch_name

dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
S = json.loads((QDIR / 'sensitivity.json').read_text())
NAMES = S['names']
ORDER = sorted(NAMES, key=lambda n: -S['ablation'][n]['gapdiff_mean'])
KEEP_FP = ORDER[:4]                      # net.43, net.0, net.46, dqn.net
QUANT = [n for n in NAMES if n not in KEEP_FP]  # 80개 residual conv


def ste_round(x):
    return (x.round() - x).detach() + x


def fq_act(x, lo, hi):
    s = (hi - lo) / 255.0
    zp = round(-lo / s)
    return (torch.clamp(ste_round(x / s) + zp, 0, 255) - zp) * s


def fq_weight(w):
    flat = w.detach().reshape(w.shape[0], -1)
    s = (flat.abs().amax(1) / 127.0).clamp_min(1e-12).view(-1, *([1] * (w.dim() - 1)))
    return torch.clamp(ste_round(w / s), -127, 127) * s


class QConv(torch.nn.Module):
    def __init__(self, conv, in_rng, out_rng, act=True):
        super().__init__()
        self.conv, self.in_rng, self.out_rng, self.act = conv, in_rng, out_rng, act

    def forward(self, x):
        if self.act:
            x = fq_act(x, *self.in_rng)
        if isinstance(self.conv, torch.nn.Linear):  # encoder 끝 Linear / Q head (가중치 전용 모드에서만 래핑됨)
            y = F.linear(x, fq_weight(self.conv.weight), self.conv.bias)
        else:
            y = F.conv1d(x, fq_weight(self.conv.weight), self.conv.bias, self.conv.stride, self.conv.padding)
        return fq_act(y, *self.out_rng) if self.act else y


def set_module(root, name, new):
    parent, _, attr = name.rpartition('.')
    setattr(root.get_submodule(parent) if parent else root, attr, new)


def rng_of(lo, hi):
    return (min(lo, 0.0), max(hi, 0.0, min(lo, 0.0) + 1e-6))


@torch.no_grad()
def fwd(net, obs, mask, bs=128):
    return torch.cat([net(obs[i:i + bs], mask[i:i + bs]) for i in range(0, len(obs), bs)])


def calibrate_ranges(net, obs, mask):
    mods = dict(net.named_modules())
    rec, hooks = {}, []
    for n in QUANT:
        def hk(m, inp, out, n=n):
            a = rec.setdefault(n, [1e30, -1e30, 1e30, -1e30])
            a[0], a[1] = min(a[0], float(inp[0].min())), max(a[1], float(inp[0].max()))
            a[2], a[3] = min(a[2], float(out.min())), max(a[3], float(out.max()))
        hooks.append(mods[n].register_forward_hook(hk))
    fwd(net, obs, mask)
    for h in hooks:
        h.remove()
    return {n: (rng_of(a[0], a[1]), rng_of(a[2], a[3])) for n, a in rec.items()}


def distill_loss(qs, qt, mask):
    """qs/qt: (B,46) 합법 위치 외에는 -inf. 격차(오프셋 불변) 오차 + 정책 KL."""
    big = -1e9
    qs_m, qt_m = qs.masked_fill(~mask, big), qt.masked_fill(~mask, big)
    n = mask.sum(-1, keepdim=True).clamp_min(1)
    diff = torch.where(mask, qs_m - qt_m, torch.zeros_like(qs_m))
    diff = torch.where(mask, diff - diff.sum(-1, keepdim=True) / n, torch.zeros_like(diff))  # V 오프셋 제거
    gap_t = qt_m.max(-1, keepdim=True).values - qt_m
    w = torch.where(mask, torch.where(gap_t < 1.0, 4.0, 1.0), torch.zeros_like(qs_m))      # 최선 근처 행동을 더 중시
    gl = (w * F.smooth_l1_loss(diff, torch.zeros_like(diff), reduction='none', beta=0.05)).sum() / w.sum().clamp_min(1)
    lp_t, lp_s = torch.log_softmax(qt_m, -1), torch.log_softmax(qs_m, -1)
    kl = (lp_t.exp() * (lp_t - lp_s) * mask).sum(-1).mean()
    return gl + 10.0 * kl, gl.detach(), kl.detach()


def export_onnx(net, path):
    obs = torch.zeros(2, 1012, 34)
    mask = torch.ones(2, 46, dtype=torch.bool)
    net = net.cpu().eval()
    torch.onnx.export(net, (obs, mask), str(path), input_names=['obs', 'mask'], output_names=['q'],
                      dynamic_axes={'obs': {0: 'n'}, 'mask': {0: 'n'}, 'q': {0: 'n'}}, opset_version=17, dynamo=False)


def ptq_int8(onnx_fp32, tag):
    """튜닝된 fp32 ONNX → 기존 파이프라인과 같은 방식으로 int8(QDQ, MinMax)+fp16 저장. 반환: 최종 파일 경로"""
    pre = QDIR / f'{tag}.pre.onnx'
    quant_pre_process(str(onnx_fp32), str(pre), skip_symbolic_shape=True)
    pm = onnx.load(str(pre))
    cand_nodes = set(S['onnx_node'].values())
    always = [n.name for n in pm.graph.node if n.op_type in ('Conv', 'Gemm') and n.name not in cand_nodes]
    keep_fp_nodes = [S['onnx_node'][n] for n in KEEP_FP]
    obs, mask = load_set('calib')
    tmp = QDIR / f'{tag}.int8.onnx'
    quantize_static(str(pre), str(tmp), Reader(obs[:CALIB_N], mask[:CALIB_N]), quant_format=QuantFormat.QDQ,
                    per_channel=True, weight_type=QuantType.QInt8, activation_type=QuantType.QUInt8,
                    op_types_to_quantize=['Conv', 'Gemm'], nodes_to_exclude=always + keep_fp_nodes,
                    calibrate_method=CalibrationMethod.MinMax,
                    extra_options={'ActivationSymmetric': False, 'WeightSymmetric': True})
    dst = QDIR / f'{tag}.onnx'
    make_fp16_storage(tmp, dst)
    tmp.unlink()
    pre.unlink()
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--steps', type=int, default=4000)
    ap.add_argument('--lr', type=float, default=3e-5)
    ap.add_argument('--bs', type=int, default=64)
    ap.add_argument('--tag', default='qat1')
    ap.add_argument('--weight-only', action='store_true', help='가중치만 int8 fake-quant (활성 fp32). 민감 상위 --keep 개는 fp')
    ap.add_argument('--keep', type=int, default=4)
    args = ap.parse_args()
    global KEEP_FP, QUANT
    if args.weight_only:  # 가중치 전용 민감도(wo-results.json) 기준으로 fp 유지 레이어 결정
        wo = json.loads((QDIR / 'wo-results.json').read_text())['weight_only_sensitivity']
        KEEP_FP = sorted(NAMES, key=lambda n: -wo[n])[:args.keep]
        QUANT = [n for n in NAMES if n not in KEEP_FP]
    torch.manual_seed(0)
    np.random.seed(0)

    teacher = load().to(dev).eval()
    for p in teacher.parameters():
        p.requires_grad_(False)
    student = load().to(dev).eval()

    to_t = lambda a: torch.from_numpy(np.ascontiguousarray(a)).to(dev)  # noqa: E731
    c_obs, c_mask = load_set('calib')
    ranges = ({n: ((0.0, 1.0), (0.0, 1.0)) for n in QUANT} if args.weight_only
              else calibrate_ranges(student, to_t(c_obs[:512]), to_t(c_mask[:512])))
    mods = dict(student.named_modules())
    for n in QUANT:
        set_module(student, n, QConv(mods[n], *ranges[n], act=not args.weight_only))
    student.eval()  # BN 통계 고정
    val_obs, val_mask = to_t(c_obs[1536:]), to_t(c_mask[1536:])  # 모니터링용(보정셋 뒤쪽, 평가셋과 별개 대국)
    with torch.no_grad():
        val_qt = fwd(teacher, val_obs, val_mask).cpu().numpy()
    val_m = val_mask.cpu().numpy()

    tr_meta = json.loads((DATA / 'train.json').read_text())
    N = tr_meta['n']
    tr_obs = np.memmap(DATA / 'train.obs.f32', dtype=np.float32, mode='r', shape=(N, 1012, 34))
    tr_mask = np.fromfile(DATA / 'train.mask.u8', dtype=np.uint8).reshape(N, 46).astype(bool)
    print(f'device={dev} train={N} quant_layers={len(QUANT)} fp_layers={KEEP_FP}', flush=True)
    # 과적합 진단: 학습셋 일부(고정 800개)의 오차를 val과 나란히 본다
    sub = np.sort(np.random.RandomState(1).choice(N, 800, replace=False))
    sub_obs, sub_mask = to_t(tr_obs[sub]), to_t(tr_mask[sub])
    with torch.no_grad():
        sub_qt = fwd(teacher, sub_obs, sub_mask).cpu().numpy()
    sub_m = sub_mask.cpu().numpy()

    params = [p for p in student.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / 100) * 0.5 * (1 + np.cos(np.pi * min(1.0, s / args.steps))))

    def monitor():
        qs = fwd(student, val_obs, val_mask).cpu().numpy()
        return metrics(val_qt, qs, val_m)

    def monitor_train():
        return metrics(sub_qt, fwd(student, sub_obs, sub_mask).cpu().numpy(), sub_m)['gapdiff_mean']

    log = []
    m0, tg0 = monitor(), monitor_train()
    print(f"step 0 (fake-quant, 학습 전) val gapΔ={m0['gapdiff_mean']:.5f} p99={m0['gapdiff_p99']:.4f} flip={m0['bin_flip']:.5f} top1={m0['top1_agree']:.4f} | train-subset gapΔ={tg0:.5f}", flush=True)
    log.append({'step': 0, 'train_subset_gapdiff': tg0, **{k: m0[k] for k in ('gapdiff_mean', 'gapdiff_p99', 'bin_flip', 'top1_agree', 'kl')}})
    t0 = time.time()
    perm = np.random.permutation(N)
    pos = 0
    run = np.zeros(3)
    for step in range(1, args.steps + 1):
        if pos + args.bs > N:
            perm, pos = np.random.permutation(N), 0
        idx = np.sort(perm[pos:pos + args.bs])
        pos += args.bs
        o, mk = to_t(tr_obs[idx]), to_t(tr_mask[idx])
        with torch.no_grad():
            qt = teacher(o, mk)
        qs = student(o, mk)
        loss, gl, kl = distill_loss(qs, qt, mk)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        sched.step()
        run += np.array([float(loss), float(gl), float(kl)])
        if step % 100 == 0:
            print(f'step {step} loss={run[0] / 100:.5f} gap={run[1] / 100:.5f} kl={run[2] / 100:.6f} lr={sched.get_last_lr()[0]:.2e} {time.time() - t0:.0f}s', flush=True)
            run[:] = 0
        if step % 500 == 0 or step == args.steps:
            m, tg = monitor(), monitor_train()
            print(f"  [val] gapΔ={m['gapdiff_mean']:.5f} p99={m['gapdiff_p99']:.4f} flip={m['bin_flip']:.5f} top1={m['top1_agree']:.4f} | train-subset gapΔ={tg:.5f}", flush=True)
            log.append({'step': step, 'train_subset_gapdiff': tg, **{k: m[k] for k in ('gapdiff_mean', 'gapdiff_p99', 'bin_flip', 'top1_agree', 'kl')}})

    # fake-quant 래퍼 제거 → 튜닝된 fp32 가중치
    for n in QUANT:
        set_module(student, n, student.get_submodule(n).conv)
    torch.save(student.state_dict(), QDIR / f'{args.tag}.pt')
    fp32_onnx = QDIR / f'{args.tag}.fp32.onnx'
    export_onnx(student, fp32_onnx)
    if args.weight_only:
        from weight_only import make_weight_only  # 순환 import 방지용 지연 import
        dst = QDIR / f'{args.tag}.onnx'
        make_weight_only(fp32_onnx, dst, QUANT)
    else:
        dst = ptq_int8(fp32_onnx, args.tag)

    # 최종: 평가셋에서 실제 ORT int8 결과를 fp32 원본 대비 측정 (PTQ-only 기준선 par-abl-k4와 비교)
    ev_obs, ev_mask = load_set('eval')
    tq = np.load(QDIR / 'teacher_eval.npy')
    qs, ms = run_q(dst, ev_obs, ev_mask)
    mb, gz = file_sizes(dst)
    final = {'size_mb': round(mb, 1), 'gz_mb': round(gz, 1), **metrics(tq, qs, ev_mask), 'steps': args.steps, 'lr': args.lr, 'val_curve': log}
    (QDIR / f'{args.tag}.json').write_text(json.dumps(final, indent=1))
    base = (json.loads((QDIR / 'wo-results.json').read_text())[f'wo-keep-top{args.keep}'] if args.weight_only
            else json.loads((QDIR / 'pareto.json').read_text())['abl-k4'])
    print('\n=== 평가셋(실제 ORT int8+fp16, fp32 대비) ===')
    print(f"{'':14} {'MB':>5} {'gapΔmean':>9} {'gapΔp99':>8} {'binflip':>8} {'top1':>7} {'loss>.1':>8} {'KL':>9}")
    for nm, v in (('PTQ baseline', base), (args.tag, final)):
        print(f"{nm:14} {v['size_mb']:5.1f} {v['gapdiff_mean']:9.5f} {v['gapdiff_p99']:8.4f} {v['bin_flip']:8.5f} {v['top1_agree']:7.4f} {v['gap>0.1']:8.4f} {v['kl']:9.6f}")


if __name__ == '__main__':
    main()
