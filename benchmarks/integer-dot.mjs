// Build each checkout first. Samples run sequentially in fresh processes.
// node benchmarks/integer-dot.mjs --root /path/to/checkout --samples 3
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const { values } = parseArgs({ options: {
    root: { type: 'string', default: resolve(import.meta.dirname, '..') },
    samples: { type: 'string', default: '3' },
    case: { type: 'string', default: 'all' },
    worker: { type: 'boolean', default: false },
} });
const root = resolve(values.root), count = Number(values.samples);
const expressions = {
    dot: '(X matmul Y) mod 1000000123',
    sum: '((X * Y) mod 1000000123) sum',
    equivalent: '(((X * Y) mod 1000000123) sum) mod 1000000123',
};
assert(Number.isSafeInteger(count) && count > 0);
assert(values.case === 'all' || Object.hasOwn(expressions, values.case));
if (!values.worker) {
    const names = values.case === 'all' ? Object.keys(expressions) : [values.case];
    const samples = Object.fromEntries(names.map(name => [name, []]));
    for (let i = 0; i < count; i++) for (const name of names) {
        const run = spawnSync(process.execPath, [import.meta.filename, '--worker', '--root', root, '--case', name], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr || run.stdout);
        samples[name].push(JSON.parse(run.stdout));
    }
    const medianMs = Object.fromEntries(names.map(name => {
        const times = samples[name].map(sample => sample.ms).sort((a, b) => a - b);
        return [name, times[Math.floor(times.length / 2)]];
    }));
    console.log(JSON.stringify({ root, node: process.version, cpu: cpus()[0].model, medianMs, samples }, null, 2));
} else {
    const { Interpreter } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
    const modulus = 1000000123n;
    let dot = 0n, sum = 0n;
    for (let i = 1n; i <= 25000n; i++) {
        const product = (i * 999999937n % modulus) * (i * 123456789n % modulus);
        dot += product;
        sum += product % modulus;
    }
    const expected = { dot: dot % modulus * 2000n, sum: sum * 2000n, equivalent: sum % modulus * 2000n };
    const runtime = new Interpreter();
    try {
        const source = `use numbers
use sequences
use linalg
A = (1 to 50000 array) * 999999937 mod 1000000123
W = (1 to 50000 array) * 123456789 mod 1000000123
T = 0
for I in 1 to 2000
  X = A (0 till 25000 array)
  Y = W (0 till 25000 array)
  T += ${expressions[values.case]}
end
T`;
        const start = performance.now();
        runtime.execute(source);
        const ms = performance.now() - start;
        assert.equal(runtime.variables.get('T'), expected[values.case]);
        console.log(JSON.stringify({ ms, checksum: String(expected[values.case]) }));
    } finally { runtime.dispose(); }
}
