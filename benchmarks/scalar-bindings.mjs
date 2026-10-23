// npx tsc -b tsconfig.build.json
// node benchmarks/scalar-bindings.mjs --baseline=/path/to/baseline-checkout
// Both checkouts need built packages/interpreter/out and their dependencies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(baseline|checkout|worker)=(.+)$/.exec(arg);
    assert(match, `Unknown argument: ${arg}`);
    return [match[1], match[2]];
}));
const cases = {
    globals: { source: 'Total = 0\nfor I in 1 to 100000\n Total += I\nend\nTotal', expected: 5000050000n, generic: true },
    locals: { source: 'fun N work\n Total = 0\n for I in 1 to N\n  Total += I\n end\n return Total\nend\n100000 work', expected: 5000050000n, generic: true },
    text: { source: 'use text\nfun N work\n Total = 0\n for I in 0 till N\n  S = I text\n  if not (S startswith "1")\n   Total += S len\n  end\n end\n return Total\nend\n100000 work', expected: 434569n, generic: true },
    compiled: { source: 'fun N work\n Total = 0\n for I in 1 to N\n  Total += I\n end\n return Total\nend\n100000 work', expected: 5000050000n },
    recursive: { source: 'fun N fib\n if N less 2\n  return N\n end\n A = (N - 1) fib\n B = (N - 2) fib\n return A + B\nend\n22 fib', expected: 17711n },
    euler16: { source: readFileSync(resolve(root, 'demos/euler/016_powerdigits.ra'), 'utf8'), expected: 1366n, answer: 'Answer' },
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const hash = text => createHash('sha256').update(text).digest('hex');
if (options.worker) {
    const spec = cases[options.worker];
    assert(spec, 'Unknown case');
    const { Interpreter, parse } = await import(pathToFileURL(resolve(options.checkout ?? root, 'packages/interpreter/out/index.js')));
    const ast = parse(spec.source);
    const runtime = new Interpreter(() => {}, { integerLoopCompilation: !spec.generic });
    const times = [];
    try {
        for (let run = 0; run < 9; run++) {
            const start = performance.now();
            const value = runtime.executeProgram(ast);
            times.push(performance.now() - start);
            assert.equal(spec.answer ? runtime.variables.get(spec.answer) : value, spec.expected);
        }
    } finally { runtime.dispose(); }
    console.log(JSON.stringify({ firstMs: times[0], warmMs: times.slice(3) }));
} else {
    assert(options.baseline, 'Supply --baseline with a built baseline checkout');
    const checkouts = { baseline: resolve(options.baseline), candidate: root };
    const results = [];
    for (const name of [...Object.keys(cases), 'matvec', 'kmeans', 'gradient']) {
        const processes = { baseline: [], candidate: [] };
        for (let round = 0; round < 3; round++) {
            // Alternate order, with no competing benchmark or test workers.
            for (const variant of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
                const script = name in cases ? fileURLToPath(import.meta.url) : resolve(root, 'benchmarks/numerical-demos.mjs');
                const args = [`--worker=${name}`, `--checkout=${checkouts[variant]}`];
                if (!(name in cases)) args.push('--scale=1', '--samples=6');
                const child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 120000 });
                assert.equal(child.status, 0, child.stderr);
                processes[variant].push(JSON.parse(child.stdout));
            }
        }
        const baselineMs = median(processes.baseline.map(p => median(p.warmMs)));
        const candidateMs = median(processes.candidate.map(p => median(p.warmMs)));
        results.push({ name, sourceSha256: name in cases ? hash(cases[name].source) : undefined,
            baselineMs, candidateMs, speedup: baselineMs / candidateMs, processes });
        console.error(`${name}: ${baselineMs.toFixed(2)} -> ${candidateMs.toFixed(2)} ms`);
    }
    console.log(JSON.stringify({ date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
        frameSha256: Object.fromEntries(Object.entries(checkouts).map(([variant, checkout]) =>
            [variant, hash(readFileSync(resolve(checkout, 'packages/interpreter/out/frame.js')))])),
        timing: 'Three fresh processes per variant, alternating order; medians of warm-run medians. Scalar cases exclude parsing and output IO, with three warmups and six measured runs. globals/locals/text disable whole-loop compilation to exercise general execution; compiled uses defaults. Numerical controls use the existing numerical-demos harness at scale 1. Every run checks its result.',
        results }, null, 2));
}
