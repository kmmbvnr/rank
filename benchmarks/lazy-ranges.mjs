// Run each variant in a fresh process so maxRSS includes its own range storage.
// node benchmarks/lazy-ranges.mjs [lazy|stored|reference] [limit] [1|6]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const [variant = 'lazy', limit = '100000000', problem = '1'] = process.argv.slice(2);
assert(['lazy', 'stored', 'reference'].includes(variant));
assert(['1', '6'].includes(problem));
assert(/^\d+$/.test(limit));
const file = problem === '1' ? '001_multiples.ra' : '006_sumsquarediff.ra';
let source = readFileSync(new URL(`../demos/euler/${file}`, import.meta.url), 'utf8');
if (variant === 'stored') source = problem === '1'
    ? source.replace("N' =", 'N =')
    : source.replace('Range * Range', 'Range ** 2');
const runtime = new Interpreter(() => {}, { args: ['--limit', limit], compilation: variant !== 'reference' });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    const answer = diagnostics.run(() => runtime.execute(source));
    const n = BigInt(limit);
    const multiples = k => { const count = (n - 1n) / k; return k * count * (count + 1n) / 2n; };
    const sum = n * (n + 1n) / 2n;
    const expected = problem === '1' ? multiples(3n) + multiples(5n) - multiples(15n)
        : sum * sum - n * (n + 1n) * (2n * n + 1n) / 6n;
    assert.equal(answer, expected);
    console.log(JSON.stringify({ variant, problem, limit, answer: String(answer), ms: performance.now() - start,
        peakRssMiB: process.resourceUsage().maxRSS / 1024, kernels: diagnostics.compiledTensors,
        numberTensors: diagnostics.numberTensors }));
} finally { runtime.dispose(); }
