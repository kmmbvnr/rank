// Build first. Every sample uses a fresh process. Search timings exclude setup.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const upper = `fun X upper A
  Lo = 0
  Hi = A len
  for Lo less Hi
    Mid = (Lo + Hi) // 2
    if A Mid at most X
      Lo = Mid + 1
    else
      Hi = Mid
    end
  end
  return Lo
end`;
const mode = option('case') ?? 'search';
if (option('worker')) {
    const { Interpreter } = await import('../packages/interpreter/out/index.js');
    const runtime = new Interpreter(() => {});
    try {
        const variant = option('worker');
        if (mode === 'search') {
            runtime.execute('use algo\nuse sequences\n' + upper);
            const start = performance.now();
            runtime.execute('Pr = primes to 35000000 array\nP1 = Pr filter (Pr mod 3 equal 1) array\nQ = (0 till 1000) * 35000 + 17');
            const setupMs = performance.now() - start;
            assert.equal(runtime.variables.get('Pr').shape[0], 2146775);
            assert.equal(runtime.variables.get('P1').shape[0], 1073096);
            const query = variant === 'native' ? 'P1 upperindex X' : 'X P1 upper';
            const source = `Total = 0\nfor X in Q\n  Total += ${query}\nend\nTotal`;
            // Separate first invocation (including compilation) from warmed calls.
            const cold = performance.now();
            assert.equal(runtime.execute(source), 553697517n);
            const coldQueryMs = performance.now() - cold;
            const samples = [];
            for (let i = 0; i < 5; i++) {
                const now = performance.now();
                assert.equal(runtime.execute(source), 553697517n);
                samples.push(performance.now() - now);
            }
            console.log(JSON.stringify({ variant, setupMs, coldQueryMs,
                queryMs: samples.sort((a, b) => a - b)[2], checksum: '553697517' }));
        } else {
            let source = readFileSync(new URL('../demos/euler/354_honeycomb.ra', import.meta.url), 'utf8');
            source = source.replace(/rem Upper bound in a sorted array\.[\s\S]*?rem Count 3\^a/, 'rem Count 3^a');
            source = source.replace('use numbers', 'use algo\nuse numbers');
            // Both variants use the same algorithm; only the search calls differ.
            source = source.replace('Count = Hi P1 upper', 'Count = P1 upperindex Hi')
                .replace('Count -= (R - 1) P1 upper', 'Count -= P1 upperindex (R - 1)');
            if (variant === 'rank') source = upper + '\n' + source.replace('Count = P1 upperindex Hi', 'Count = Hi P1 upper')
                .replace('Count -= P1 upperindex (R - 1)', 'Count -= (R - 1) P1 upper');
            const limit = option('limit') ?? '1000000000';
            runtime.execute(`Limit = ${limit}`);
            const start = performance.now();
            runtime.execute(source);
            const answer = runtime.variables.get('Answer');
            const expected = option('expected');
            if (expected) assert.equal(answer, BigInt(expected));
            console.log(JSON.stringify({ variant, limit, executeMs: performance.now() - start, answer: String(answer) }));
        }
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, case: mode }));
    const results = new Map();
    for (const variant of ['rank', 'native']) {
        const samples = [];
        for (let trial = 0; trial < Number(option('trials') ?? 3); trial++) {
            const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url),
                ...process.argv.slice(2), `--worker=${variant}`], {
                encoding: 'utf8', timeout: Number(option('timeout') ?? 30000),
            });
            if (result.error?.code === 'ETIMEDOUT') {
                console.log(JSON.stringify({ variant, trial, timeoutMs: Number(option('timeout') ?? 30000) }));
                break;
            }
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr);
            const sample = JSON.parse(result.stdout);
            if (mode === 'euler') {
                const answer = results.get('answer');
                if (answer !== undefined) assert.equal(sample.answer, answer);
                results.set('answer', sample.answer);
            }
            samples.push(sample); console.log(JSON.stringify({ ...sample, trial }));
        }
        if (samples.length) {
            const key = mode === 'search' ? 'queryMs' : 'executeMs';
            const median = samples.map(sample => sample[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
            results.set(variant, median);
            console.log(JSON.stringify({ variant, medianMs: median, samples: samples.length }));
        }
    }
    if (results.has('rank') && results.has('native')) {
        console.log(JSON.stringify({ speedup: results.get('rank') / results.get('native') }));
    }
}
