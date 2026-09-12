import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { Interpreter } from '../packages/interpreter/out/index.js';

const forms = {
  inline: 'return (A * A + A * 2.0 + 1.0) copy',
  named: 'Squared = A * A\n  Shifted = Squared + A * 2.0 + 1.0\n  return Shifted copy',
  assignment: 'Result = (A * A + A * 2.0 + 1.0) copy\n  return Result',
};
const results = [];
for (const [form, body] of Object.entries(forms)) {
  for (const size of [0, 1, 1000, 10000, 100000, 1000000]) {
    const items = Array.from({ length: size }, (_, i) => (i % 101 - 50) / 8);
    const input = { kind: 'array', shape: [size], items };
    const expected = items.map(x => x * x + x * 2.0 + 1.0);
    const cases = [false, true].map(tensorFusion => {
      const start = performance.now();
      const runtime = new Interpreter(undefined, { tensorFusion });
      runtime.execute('use sequences\nfun probe A\n  ' + body + '\nend');
      const prepareMs = performance.now() - start;
      const call = () => runtime.variables.get('probe').call([input]).items;
      const cold = performance.now();
      const coldOutput = call();
      const coldMs = performance.now() - cold;
      assert.deepEqual(coldOutput, expected);
      for (let i = 0; i < 3; i++) assert.deepEqual(call(), expected);
      return { runtime, call, tensorFusion, prepareMs, coldMs, samples: [] };
    });
    const js = { call: () => {
      const out = new Array(size);
      for (let i = 0; i < size; i++) { const x = items[i]; out[i] = x * x + x * 2.0 + 1.0; }
      return out;
    }, samples: [], tensorFusion: 'js' };
    for (let i = 0; i < 3; i++) assert.deepEqual(js.call(), expected);
    for (let i = 0; i < 5; i++) {
      for (const c of i % 2 ? [...cases, js].reverse() : [...cases, js]) {
        const start = performance.now();
        const output = c.call();
        c.samples.push(performance.now() - start);
        assert.deepEqual(output, expected);
      }
    }
    for (const c of cases) {
      results.push({ form, size, fused: c.tensorFusion, prepareMs: c.prepareMs,
        coldMs: c.coldMs, samplesMs: c.samples });
      c.runtime.dispose();
    }
    results.push({ form, size, fused: 'js', samplesMs: js.samples });
    let kernels = 0, generated = '';
    const probe = new Interpreter(undefined, {
      onTensorKernelExecuted: () => kernels++,
      onTensorKernelCompiled: source => { generated = source; },
    });
    probe.execute('use sequences\nfun probe A\n  ' + body + '\nend');
    assert.deepEqual(probe.variables.get('probe').call([input]).items, expected);
    probe.dispose();
    results.push({ form, size, coverage: true, kernels, generated });
    process.stderr.write(form + ' ' + size + '\n');
  }
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), results }, null, 2));
