// npm run build && node benchmarks/powmod-short.mjs [--reps=N]
// Short vectors (2262 primes below 20000), as in Euler 650: the cost is
// per-statement overhead and boxed cells, not memory bandwidth.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const reps = Number(process.argv.find(a => a.startsWith('--reps='))?.slice(7) ?? 5000);
const { Interpreter } = await import(new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const cases = {
    powmod: 'Pr E M powmod',
    'mul mod': 'Pr * Pr mod M',
    'compare': '(Pr at most 9000) integer',
};
const runtime = new Interpreter();
try {
    runtime.execute('use numbers\nuse sequences\nM = 1000000007\nPr = primes to 20000 array\nE = Pr + 1000');
    assert.equal(runtime.execute('Pr len'), 2262n);
    assert.equal(runtime.execute('(Pr 5) (Pr 5 + 1000) M powmod'), 13n ** 1013n % 1000000007n);
    for (const [name, code] of Object.entries(cases)) {
        runtime.execute(`for K in 1 to 50\n Z = ${code}\nend`);
        const start = performance.now();
        runtime.execute(`for K in 1 to ${reps}\n Z = ${code}\nend`);
        const ms = performance.now() - start;
        console.log(JSON.stringify({ name, reps, ms: Math.round(ms), nsPerCell: Math.round(ms * 1e6 / reps / 2262) }));
    }
} finally { runtime.dispose(); }
