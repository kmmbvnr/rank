// Build both checkouts first: npx tsc -b tsconfig.build.json.
// node benchmarks/dense-sum-squares.mjs --baseline=/path/to/checkout --trials=3
// --full verifies B(10^10); timings are measurements, never a CI deadline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'demos/euler/311_biclinic.ra'), 'utf8');
const fun = source.slice(source.indexOf('fun Low biclinic_block High'));
const body = fun.slice(fun.indexOf('\n') + 1, fun.lastIndexOf('  return Answer'));
const split = body.indexOf('  Answer = 0\n');
const accumulate = body.slice(0, split), scan = body.slice(split);
const imports = 'use numbers\nuse sequences\n';
const blocks = [{ name: 'first', low: 1, high: 4000000 },
    { name: 'middle', low: 1248000001, high: 1252000000 },
    { name: 'last', low: 2496000001, high: 2500000000 }];
function reference(low, high) {
    const counts = new Uint32Array(high - low + 1);
    for (let y = 1; y * y * 2 <= high; y++) {
        const square = y * y;
        const first = Math.max(y + 1, Math.ceil(Math.sqrt(Math.max(0, low - square))));
        for (let x = first; x * x + square <= high; x++) counts[x * x + square - low]++;
    }
    let answer = 0;
    for (let i = 0; i < counts.length; i++) {
        const r = counts[i], n = low + i;
        if (r < 2) continue;
        answer += r * (r - 1) * (r - 2) / 6;
        if (n % 2 === 0 && Number.isInteger(Math.sqrt(n / 2))) answer += r * (r - 1) / 2;
    }
    return BigInt(answer);
}
if (option('worker')) {
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(option('root') ?? root, 'packages/interpreter/out/index.js')).href);
    const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter(() => {});
    const diagnostic = process.argv.includes('--diagnostic');
    const execute = program => diagnostic ? diagnostics.run(() => runtime.execute(program)) : runtime.execute(program);
    try {
        const name = option('worker');
        if (name === 'full') {
            const start = performance.now(); execute(source);
            assert.equal(runtime.variables.get('Answer'), 2466018557n);
            console.log(JSON.stringify({ name, totalMs: performance.now() - start, answer: '2466018557', ...(diagnostic ? { diagnostics } : {}) }));
        } else {
            const block = blocks.find(block => block.name === name); assert.ok(block);
            const expected = reference(block.low, block.high);
            runtime.execute(''); // Initialize the parser before measuring the block.
            const start = performance.now();
            execute(`${imports}Low = ${block.low}\nHigh = ${block.high}\n${accumulate}`);
            const accumulateMs = performance.now() - start;
            const scanStart = performance.now(); execute(scan);
            const scanMs = performance.now() - scanStart;
            assert.equal(runtime.variables.get('Answer'), expected);
            console.log(JSON.stringify({ name, accumulateMs, scanMs, totalMs: accumulateMs + scanMs,
                answer: String(expected), maxRssMiB: process.resourceUsage().maxRSS / 1024, ...(diagnostic ? { diagnostics } : {}) }));
        }
    } finally { runtime.dispose(); }
} else {
    const full = process.argv.includes('--full');
    const trials = Number(option('trials') ?? (full ? 1 : 3));
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timings: 'fresh processes with parser initialized; accumulation includes allocation and compilation; scan includes storage preparation; diagnostics separate' }));
    const cases = full ? ['full'] : (option('cases')?.split(',') ?? blocks.map(block => block.name));
    for (const name of cases) {
        for (const [variant, checkout] of [['candidate', root], ...(option('baseline') ? [['baseline', option('baseline')]] : [])]) {
            const samples = [];
            for (let trial = 0; trial < trials + (name === 'full' ? 0 : 1); trial++) {
                const diagnostic = trial === trials;
                const child = spawnSync(process.execPath, [import.meta.filename, `--worker=${name}`, `--root=${checkout}`,
                    ...(diagnostic ? ['--diagnostic'] : [])], { encoding: 'utf8', timeout: name === 'full' ? 1800000 : 120000 });
                assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
                const sample = JSON.parse(child.stdout); console.log(JSON.stringify({ variant, trial, diagnostic, ...sample }));
                if (!diagnostic) samples.push(sample);
            }
            const median = key => samples.map(sample => sample[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
            console.log(JSON.stringify({ name, variant, medianTotalMs: median('totalMs'),
                ...(name === 'full' ? {} : { medianAccumulateMs: median('accumulateMs'), medianScanMs: median('scanMs') }) }));
        }
    }
}
