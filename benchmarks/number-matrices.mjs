// Issue #445: parse once, initialize a fresh matrix outside each elimination timer.
// node benchmarks/number-matrices.mjs --baseline=/path/to/checkout --samples=7
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(baseline|samples)=(.+)$/.exec(arg);
    assert(match, `Unknown argument: ${arg}`);
    return [match[1], match[2]];
}));
const samples = Number(options.samples ?? 7);
assert(Number.isSafeInteger(samples) && samples >= 3);
const size = 212, width = size + 1;
const initialize = `use numbers
use sequences
Nn = ${size}
A = array shape Nn (Nn + 1) fill 0.0
for I in 0 till Nn
 for J in 0 till Nn
  A I J = 1.0 / (I + J + 1)
 end
 A I I = (A I I) + 1.0
 A I Nn = 1.0
end`;
const eliminate = `for C in 0 till Nn
 Pv = A C C
 for R in (C + 1) till Nn
  F = (A R C) / Pv
  for J in C to Nn
   A R J -= F * (A C J)
  end
 end
end`;
// Independent JavaScript oracle for all cells, including the augmented column.
const expected = new Float64Array(size * width);
for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) expected[i * width + j] = 1 / (i + j + 1);
    expected[i * width + i] += 1;
    expected[i * width + size] = 1;
}
for (let c = 0; c < size; c++) {
    const pivot = expected[c * width + c];
    for (let r = c + 1; r < size; r++) {
        const factor = expected[r * width + c] / pivot;
        for (let j = c; j <= size; j++) expected[r * width + j] -= factor * expected[c * width + j];
    }
}
const oracle = Array.from(expected);
const checkouts = { candidate: root, ...options.baseline ? { baseline: resolve(options.baseline) } : {} };
const versions = {};
const runtimes = {};
for (const [name, checkout] of Object.entries(checkouts)) {
    const api = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const { parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/parser.js')));
    runtimes[name] = { api, init: parse(initialize), loop: parse(eliminate) };
    versions[name] = { checkout, revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirty: Boolean(execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim()),
        eliminationMs: [], wholeMs: [], diagnostics: undefined };
}
for (let sample = -2; sample < samples; sample++) {
    const order = Object.keys(checkouts);
    if (sample % 2) order.reverse();
    for (const name of order) {
        const { api, init, loop } = runtimes[name];
        const runtime = new api.Interpreter(), diagnostics = new api.RuntimeDiagnostics();
        try {
            const start = performance.now();
            diagnostics.run(() => runtime.executeProgram(init));
            const ready = performance.now();
            diagnostics.run(() => runtime.executeProgram(loop));
            const end = performance.now();
            assert.deepEqual(Array.from(runtime.variables.get('A').items), oracle, `${name}: every matrix cell`);
            if (name === 'candidate') assert.equal(diagnostics.numberLoops, 2);
            assert.equal(diagnostics.numberLoopOverflows, 0);
            if (sample >= 0) {
                versions[name].eliminationMs.push(end - ready);
                versions[name].wholeMs.push(end - start);
                versions[name].diagnostics = { numberLoops: diagnostics.numberLoops, compiledLoops: diagnostics.compiledLoops };
            }
        } finally { runtime.dispose(); }
    }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const version of Object.values(versions)) {
    version.eliminationMedianMs = median(version.eliminationMs);
    version.wholeMedianMs = median(version.wholeMs);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, samples, warmups: 2,
    timing: 'parse once; fresh interpreter and matrix; alternating checkout order; all cells checked against JS oracle outside timer',
    versions, speedup: versions.baseline ? versions.baseline.eliminationMedianMs / versions.candidate.eliminationMedianMs : undefined,
    under50ms: versions.candidate.eliminationMedianMs < 50 }, null, 2));
