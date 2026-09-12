import assert from 'node:assert/strict';
import { Interpreter } from '../packages/interpreter/out/index.js';

const runtime = new Interpreter();
runtime.execute('use sequences\nfun transform A\n  return (A * A + A * 2.0 + 1.0) copy\nend');
const items = Array.from({ length: 1000000 }, (_, i) => (i % 101 - 50) / 8);
const input = { kind: 'array', shape: [items.length], items };
const call = () => runtime.variables.get('transform').call([input]).items;
try {
  assert.deepEqual(call(), items.map(x => x * x + x * 2.0 + 1.0));
  for (let i = 0; i < 200; i++) {
    const result = call();
    assert.equal(result.length, items.length);
    assert.equal(result[0], items[0] * items[0] + items[0] * 2.0 + 1.0);
  }
} finally { runtime.dispose(); }
