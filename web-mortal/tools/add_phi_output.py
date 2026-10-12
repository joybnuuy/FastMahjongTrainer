"""배포 엔진(ONNX)에 몸체 특징 phi(1024)를 추가 출력으로 붙인다. 가중치/그래프는 그대로, Identity 노드 하나와 출력 하나만 추가.
스타일 헤드(선수/군집 보정)는 phi 위에서 JS 로 계산한다.
사용: ai/.venv/Scripts/python web-mortal/tools/add_phi_output.py <입력.onnx> <출력.onnx>
"""
import sys
import onnx
from onnx import TensorProto, helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
PHI_SRC = '/brain/actv/Mul_output_0'        # DQN 의 Gemm 입력 (= Brain 출력 활성)
prod = {o: nd for nd in g.node for o in nd.output}
gemm = prod['/dqn/net/Gemm_output_0']
assert gemm.input[0] == PHI_SRC, f'예상과 다른 그래프: {gemm.input[0]}'
if any(o.name == 'phi' for o in g.output):
    raise SystemExit('이미 phi 출력이 있습니다')
g.node.append(helper.make_node('Identity', [PHI_SRC], ['phi'], name='/export/phi'))
g.output.append(helper.make_tensor_value_info('phi', TensorProto.FLOAT, ['n', 1024]))
onnx.checker.check_model(m)
onnx.save(m, dst)
print('저장', dst, '출력:', [o.name for o in g.output])
