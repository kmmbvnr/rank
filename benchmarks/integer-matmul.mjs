// Build each checkout first. Each sample runs in a fresh process.
// node benchmarks/integer-matmul.mjs --root /path/to/checkout --case integer --samples 3
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const option = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
};
const root = resolve(option('--root', resolve(import.meta.dirname, '..')));
const name = option('--case', 'integer');
assert(['integer', 'real', 'wide'].includes(name));
if (process.argv.includes('--worker')) {
    const { Interpreter, isRankArray } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
    const { readArrayItem } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/array-storage.js')));
    const real = name === 'real';
    const a = '999999999', b = name === 'wide' ? '1000000' : '32767';
    const cell = 121n * BigInt(a) * BigInt(b);
    const source = `use io
use sequences
use linalg
A = array shape 121 121 fill ${a}${real ? '.0' : ''}
H = array shape 121 121 fill ${b}${real ? '.0' : ''}
B = A
X = ${real ? '0.0' : '0'}
for I in 1 to 10
  B = A H matmul
  X += B 0 0
end
X print`;
    const output = [];
    const runtime = new Interpreter(line => output.push(line));
    try {
        const start = performance.now();
        runtime.execute(source);
        const elapsedMs = performance.now() - start;
        const result = runtime.variables.get('B');
        assert(isRankArray(result));
        assert.deepEqual(result.shape, [121, 121]);
        for (let i = 0; i < 121 * 121; i++) assert.equal(readArrayItem(result, i), real ? Number(cell) : cell);
        let sum = real ? 0 : 0n;
        for (let i = 0; i < 10; i++) sum += real ? Number(cell) : cell;
        assert.equal(runtime.variables.get('X'), sum);
        assert(output.length > 0);
        console.log(JSON.stringify({ elapsedMs, checksum: String(sum), cellsChecked: 121 * 121 }));
    } finally { runtime.dispose(); }
} else {
    const count = Number(option('--samples', '3'));
    assert(Number.isSafeInteger(count) && count >= 3);
    const samples = [];
    for (let i = 0; i < count; i++) {
        const child = spawnSync(process.execPath, [import.meta.filename, '--worker', '--root', root, '--case', name], { encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr || child.stdout);
        samples.push(JSON.parse(child.stdout));
    }
    const sorted = samples.map(sample => sample.elapsedMs).sort((a, b) => a - b);
    console.log(JSON.stringify({ case: name, root, node: process.version, cpu: cpus()[0].model,
        medianMs: sorted[Math.floor(count / 2)], samples }, null, 2));
}
