// Build first. All variants run on the same runtime unless --runtime is set.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const cases = [
    { name: 'original-small', limit: 100000, variant: 'original', expected: 923941n },
    { name: 'factors-small', limit: 100000, variant: 'factors', expected: 923941n },
    { name: 'search-small', limit: 100000, expected: 923941n },
    { name: 'original-million', limit: 1000000, variant: 'original', expected: 23294055n },
    { name: 'search-million', limit: 1000000, expected: 23294055n },
    { name: 'original-full', limit: 10000000000, variant: 'original', expected: 5943040885644n },
    { name: 'full', limit: 10000000000, expected: 5943040885644n },
    { name: 'full-reference', limit: 10000000000, compilation: false, expected: 5943040885644n },
];

if (option('worker')) {
    const entry = cases.find(entry => entry.name === option('worker'));
    assert.ok(entry, 'unknown benchmark case');
    const runtime = option('runtime') ? pathToFileURL(option('runtime')) : new URL('../packages/interpreter/out/index.js', import.meta.url);
    const { Interpreter } = await import(runtime.href);
    let source = readFileSync(new URL(entry.variant ? './fixtures/euler342-original.ra' : '../demos/euler/342_totientcube.ra', import.meta.url), 'utf8')
        .replace('option Limit integer = 10000000000', `option Limit integer = ${entry.limit}`);
    if (entry.variant === 'factors') {
        // Isolate reuse of the general factorizer without changing enumeration.
        source = source.replace('use numbers', 'use numbers\nuse sequences')
            .replace(/  X = N\n[\s\S]*?  return Phi/, '  for P in N factors unique\n    Phi -= Phi // P\n  end\n  return Phi');
    }
    const interpreter = new Interpreter(() => {}, { compilation: entry.compilation ?? true });
    const start = performance.now();
    try {
        interpreter.execute(source);
        const executeMs = performance.now() - start;
        assert.equal(interpreter.variables.get('Answer'), entry.expected);
        console.log(JSON.stringify({ case: entry.name, executeMs, result: String(entry.expected), maxRssKiB: process.resourceUsage().maxRSS }));
    } finally { interpreter.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout-ms') ?? 30000);
    assert.ok(Number.isSafeInteger(trials) && trials > 0);
    assert.ok(Number.isSafeInteger(timeout) && timeout > 0);
    const selected = (option('cases') ?? 'original-small,factors-small,search-small,original-million,search-million,full,full-reference').split(',');
    assert.ok(selected.every(name => cases.some(entry => entry.name === name)), 'unknown benchmark case');
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, timings: 'fresh processes; parsing, prime table and search included; result checked on every completed sample' }));
    for (const entry of cases.filter(entry => selected.includes(entry.name))) {
        const samples = [];
        for (let trial = 0; trial < trials; trial++) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                ...(option('runtime') ? [`--runtime=${option('runtime')}`] : [])], { encoding: 'utf8', timeout });
            if (child.error?.code === 'ETIMEDOUT') {
                console.log(JSON.stringify({ case: entry.name, trial, status: 'timeout', timeoutMs: timeout }));
                process.exitCode = 1;
                continue;
            }
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            const sample = { ...JSON.parse(child.stdout), trial };
            samples.push(sample.executeMs);
            console.log(JSON.stringify(sample));
        }
        if (samples.length) {
            samples.sort((a, b) => a - b);
            console.log(JSON.stringify({ case: entry.name, medianExecuteMs: samples[Math.floor(samples.length / 2)], completedSamples: samples.length }));
        }
    }
}
