import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: fileURLToPath(new URL('..', import.meta.url)) },
  size: { type: 'string', default: '1000000' },
  samples: { type: 'string', default: '5' },
  case: { type: 'string' },
  worker: { type: 'boolean', default: false },
} });
const size = Number(values.size), samples = Number(values.samples);
assert(Number.isSafeInteger(size) && size > 0 && Number.isSafeInteger(samples) && samples > 0);
const cases = ['integer-copy', 'real-copy', 'gather-scan'];
if (!values.worker) {
  const results = [];
  for (const name of values.case ? [values.case] : cases) {
    for (let sample = 0; sample < samples; sample++) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker',
        '--checkout', values.checkout, '--size', String(size), '--case', name], { encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      results.push({ sample, ...JSON.parse(child.stdout) });
    }
  }
  console.log(JSON.stringify({ node: process.version, checkout: values.checkout,
    note: 'Fresh process per sample; setup excluded; one small warmup; checks outside timing. maxRSS is process peak in KiB.', results }, null, 2));
} else {
  assert(cases.includes(values.case));
  const load = path => import(pathToFileURL(resolve(values.checkout, `packages/interpreter/out/${path}.js`)));
  const { Interpreter, RuntimeDiagnostics } = await load('index');
  const { readArrayItem, typedElementKind } = await load('array-storage');
  const runtime = new Interpreter();
  try {
    runtime.execute(`use numbers
use sequences
fun A probe_integer
 return (A * 3 + 1) copy
end
fun A probe_real
 return (A * 3.0 + 1.0) copy
end
fun Tg W Pv probe_gather
 Md = 1234567891
 for R in 1 to 5
  Va = W * Pv Tg mod Md
  Cs = Va scan + with 0
  Pv = (Cs (0 till 127) + R) mod Md
 end
 return Pv
end`);
    const gather = values.case === 'gather-scan';
    const fn = runtime.variables.get(gather ? 'probe_gather'
      : values.case === 'integer-copy' ? 'probe_integer' : 'probe_real');
    const inputs = count => {
      runtime.execute(`A = ((0 till ${count}) mod 7919) copy`);
      if (!gather) return [runtime.variables.get('A')];
      runtime.execute(`Tg = ((0 till ${count}) * 7919 mod 127) copy
W = ((0 till ${count}) mod 13 + 1) copy
Pv = array shape 127 fill 1`);
      return ['Tg', 'W', 'Pv'].map(name => runtime.variables.get(name));
    };
    fn.call(inputs(128));
    const args = inputs(size);
    const before = process.memoryUsage(), diagnostics = new RuntimeDiagnostics();
    const start = performance.now();
    const result = diagnostics.run(() => fn.call(args));
    const ms = performance.now() - start;
    const after = process.memoryUsage(), maxRSSKiB = process.resourceUsage().maxRSS;
    if (!gather) {
      assert.deepEqual(result.shape, [size]);
      for (const i of [0, Math.floor(size / 2), size - 1]) {
        const expected = (i % 7919) * 3 + 1;
        assert.equal(readArrayItem(result, i), values.case === 'integer-copy' ? BigInt(expected) : expected);
      }
    } else {
      let pv = Array(127).fill(1n);
      for (let r = 1; r <= 5; r++) {
        let acc = 0n;
        pv = Array.from({ length: Math.min(size, 127) }, (_, i) => {
          const value = (acc + BigInt(r)) % 1234567891n;
          acc += BigInt(i % 13 + 1) * pv[(i * 7919) % 127] % 1234567891n;
          return value;
        });
      }
      assert(size >= 127, 'gather-scan requires size >= 127');
      for (let i = 0; i < 127; i++) assert.equal(readArrayItem(result, i), pv[i]);
    }
    console.log(JSON.stringify({ case: values.case, size, ms, maxRSSKiB, before, after,
      storage: typedElementKind(result) ?? 'boxed', diagnostics }));
  } finally { runtime.dispose(); }
}
