// npx tsc -b tsconfig.build.json && node benchmarks/tensor-expression.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter, parse, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
import { typedArray, readArrayItem } from '../packages/interpreter/out/array-storage.js';

const cases = {
    integer: { shape: [262144], expression: 'A * A + 2 * A + 1',
        input: i => BigInt(i % 101), expected: i => BigInt((i % 101 + 1) ** 2) },
    real: { shape: [262144], expression: '(A + 0.5) * 2.0 - A',
        input: i => (i % 101) / 4, expected: i => (i % 101) / 4 + 1 },
    broadcast: { shape: [512, 512], expression: '(A - B) * (A - B) + 1',
        input: i => BigInt(i % 101), expected: i => (BigInt(i % 101) - BigInt(i % 512)) ** 2n + 1n },
};
const [name, mode] = process.argv.slice(2);
if (!name) {
    for (const name of Object.keys(cases)) for (const mode of ['separate', 'fused']) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, mode], { encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr);
        console.log(child.stdout.trim());
    }
} else {
    const test = cases[name];
    assert.ok(test && ['separate', 'fused'].includes(mode));
    const size = test.shape.reduce((a, b) => a * b, 1);
    const runtime = new Interpreter(undefined, { tensorFusion: mode === 'fused' });
    const input = name === 'real' ? Float64Array.from({ length: size }, (_, i) => test.input(i))
        : BigInt64Array.from({ length: size }, (_, i) => test.input(i));
    runtime.variables.set('A', typedArray(input, test.shape));
    if (name === 'broadcast') runtime.variables.set('B', typedArray(BigInt64Array.from({ length: 512 }, (_, i) => BigInt(i))));
    const program = parse(`R = ${test.expression}`);
    const diagnostics = new RuntimeDiagnostics();
    const times = [];
    try {
        for (let run = 0; run < 5; run++) {
            const start = performance.now();
            diagnostics.run(() => runtime.executeProgram(program));
            times.push(performance.now() - start);
            const result = runtime.variables.get('R');
            for (let i = 0; i < size; i++) assert.equal(readArrayItem(result, i), test.expected(i));
        }
        console.log(JSON.stringify({ name, mode, node: process.version, size,
            warmMs: times.slice(2), kernels: diagnostics.compiledTensors, typedUnpacks: diagnostics.typedUnpacks }));
    } finally { runtime.dispose(); }
}
