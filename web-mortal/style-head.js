// 스타일 헤드: Mortal 몸체 특징 phi(1024) 위에서 스타일별 Q 보정을 계산한다 (브라우저/Node 공용, 의존성 없음).
//   δ(phi, z) = Σ_k z_k (U_k + V_k·phi),   q_style = q_base + δ   (합법 행동에 한해)
// 가중치 파일: styles.json(메타) + styles.bin (U float32[k*46], V float16[k*46*1024], 리틀 엔디언)
const ACTIONS = 46, PHI = 1024;

function f16(h) {   // IEEE754 half → float
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

export function parseStyleHead(meta, bin) {
  const { k } = meta;
  if (meta.format !== 1 || meta.actions !== ACTIONS || meta.phi !== PHI) throw new Error('지원하지 않는 스타일 헤드 형식');
  const buf = bin instanceof ArrayBuffer ? bin : bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const need = k * ACTIONS * 4 + k * ACTIONS * PHI * 2;
  if (buf.byteLength !== need) throw new Error(`styles.bin 크기 불일치: ${buf.byteLength} / ${need}`);
  const dv = new DataView(buf);
  const U = new Float32Array(k * ACTIONS);
  for (let i = 0; i < U.length; i++) U[i] = dv.getFloat32(i * 4, true);
  const off = U.length * 4, V = new Float32Array(k * ACTIONS * PHI);
  const table = new Float32Array(65536);      // 반정밀 → 단정밀 표
  for (let h = 0; h < 65536; h++) table[h] = f16(h);
  for (let i = 0; i < V.length; i++) V[i] = table[dv.getUint16(off + i * 2, true)];
  return { k, U, V, styles: meta.styles.map(s => ({ id: s.id, z: Float32Array.from(s.z), ...s })), temperature: meta.temperature ?? 1 };
}

// phi 한 번 투영: A[k][a] = U[k][a] + V[k][a]·phi  (스타일이 여러 개여도 투영은 한 번)
export function projectPhi(head, phi) {
  const { k, U, V } = head, A = new Float32Array(k * ACTIONS);
  for (let j = 0; j < k; j++) {
    for (let a = 0; a < ACTIONS; a++) {
      const base = (j * ACTIONS + a) * PHI;
      let s = 0;
      for (let d = 0; d < PHI; d++) s += V[base + d] * phi[d];
      A[j * ACTIONS + a] = U[j * ACTIONS + a] + s;
    }
  }
  return A;
}

// 투영 결과 A 와 스타일 z 로 보정 δ[46]
export function deltaFor(head, A, z) {
  const d = new Float32Array(ACTIONS);
  for (let j = 0; j < head.k; j++) { const zj = z[j]; if (zj) for (let a = 0; a < ACTIONS; a++) d[a] += zj * A[j * ACTIONS + a]; }
  return d;
}

// 합법 행동 q(오름차순 압축) 에 스타일 보정을 더해 스타일별 q 를 돌려준다. mask: BigInt 또는 10진 문자열 비트마스크
export function styleQs(head, phi, q, mask) {
  const m = BigInt(mask), A = projectPhi(head, phi), out = {};
  const legal = []; for (let a = 0; a < ACTIONS; a++) if ((m >> BigInt(a)) & 1n) legal.push(a);
  for (const s of head.styles) {
    const d = deltaFor(head, A, s.z);
    out[s.id] = legal.map((a, i) => q[i] + d[a]);
  }
  return out;
}
