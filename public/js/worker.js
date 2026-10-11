import { generate } from './gen.js';

self.onmessage = e => {
  const { id, xml, tag, ai } = e.data;
  try {
    self.postMessage({ id, tag, out: generate(xml, id, ai) });
  } catch (err) {
    self.postMessage({ id, tag, error: String(err && err.stack || err) });
  }
};
