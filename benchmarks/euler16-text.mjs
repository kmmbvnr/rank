// npx tsc -b tsconfig.build.json && node benchmarks/euler16-text.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter, parse, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const source = readFileSync(new URL('../demos/euler/016_powerdigits.ra', import.meta.url), 'utf8');
const mode = process.argv[2];
if (!mode) {
    const results = [];
    // Each process has its own parser, compiler caches and JIT warmup.
    for (const variant of ['reference', 'compiled']) {
        for (let sample = 0; sample < 3; sample++) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), variant], { encoding: 'utf8' });
            assert.equal(child.status, 0, child.stderr);
            results.push(JSON.parse(child.stdout));
        }
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        timing: 'Unchanged Euler 16, 2^1000; executeProgram excludes parsing and output IO. Two warmup runs, five timed runs per fresh process. Reference disables only whole-loop compilation.',
        results }, null, 2));
} else {
    assert.ok(['reference', 'compiled'].includes(mode));
    const program = parse(source);
    const expected = (2n ** 1000n).toString();
    const sum = [...expected].reduce((total, digit) => total + BigInt(digit), 0n);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { integerLoopCompilation: mode === 'compiled' });
    try {
        const times = [];
        for (let run = 0; run < 7; run++) {
            const start = performance.now();
            if (run === 0) diagnostics.run(() => runtime.executeProgram(program));
            else runtime.executeProgram(program);
            times.push(performance.now() - start);
            assert.equal(runtime.variables.get('Value'), expected);
            assert.equal(runtime.variables.get('Answer'), sum);
        }
        const warmMs = times.slice(2);
        console.log(JSON.stringify({ mode, firstMs: times[0], warmMs,
            medianMs: [...warmMs].sort((a, b) => a - b)[2],
            compiledLoops: diagnostics.compiledLoops, answer: String(sum) }));
    } finally { runtime.dispose(); }
}
