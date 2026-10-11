"""web 쪽 패리티 테스트용 참조 입출력 생성 (out/ref.json)."""
import json, numpy as np, torch
from export_onnx import load, sample_inputs, OUT
net = load()
obs, mask = sample_inputs(2, 123)
with torch.inference_mode():
    q = net(torch.from_numpy(obs), torch.from_numpy(mask)).numpy()
q = np.where(np.isneginf(q), -1e9, q)
(OUT / 'ref_obs.bin').write_bytes(obs.tobytes())
(OUT / 'ref.json').write_text(json.dumps({'mask': mask.astype(int).tolist(), 'q': q.tolist()}))
print('ok')
