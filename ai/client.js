// Python Mortal 워커 클라이언트 (직렬 큐)
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PY = path.join(DIR, '.venv', 'Scripts', 'python.exe');
const MODEL = path.join(DIR, 'Mortal-S42', 'weights', 's42-inference.pth');

export const aiInstalled = () => fs.existsSync(PY) && fs.existsSync(MODEL) &&
  fs.existsSync(path.join(DIR, 'Mortal-S42', 'runtime', 'mortal', 'libriichi.pyd'));

// 압축된 (mask, q) → [{a: 행동 인덱스, q}]
export function decodeQ(mask, q) {
  const out = [];
  let k = 0;
  for (let a = 0; a < 46; a++) if ((BigInt(mask) >> BigInt(a)) & 1n) out.push({ a, q: q[k++] });
  return out;
}

export class MortalWorker {
  constructor() {
    this.proc = null; this.pending = new Map(); this.seq = 0; this.ready = null; this.chain = Promise.resolve();
  }
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      this.proc = spawn(PY, [path.join(DIR, 'analyze.py')], { cwd: DIR, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
      this.proc.on('error', reject);
      this.proc.on('exit', code => { this.ready = null; for (const p of this.pending.values()) p.reject(new Error('worker exit ' + code)); this.pending.clear(); });
      const rl = readline.createInterface({ input: this.proc.stdout });
      rl.on('line', line => {
        let m; try { m = JSON.parse(line); } catch { return; }
        if (m.ready) return resolve(m);
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.results); }
      });
    });
    return this.ready;
  }
  analyze(events, requests) {
    const run = async () => {
      await this.start();
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.proc.stdin.write(JSON.stringify({ id, events, requests }) + '\n');
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
  stop() { this.proc?.kill(); }
}
