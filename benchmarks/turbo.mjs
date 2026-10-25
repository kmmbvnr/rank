// Build both checkouts first. Example: node benchmarks/turbo.mjs --baseline=/tmp/rank-baseline
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(baseline|samples)=(.+)$/.exec(arg);
    if (!match) throw Error(`Unknown option: ${arg}`);
    return [match[1], match[2]];
}));
const samples = Number(options.samples ?? 3);
assert(Number.isSafeInteger(samples) && samples > 0);
const source = readFileSync(new URL('../demos/euler/014_collatz.ra', import.meta.url), 'utf8');
const versions = { candidate: root, ...(options.baseline ? { baseline: resolve(options.baseline) } : {}) };
const report = { node: process.version, cpu: cpus()[0]?.model, samples,
    signal: 'Android-style host callbacks and 25ms polling cache; no HTTP transport',
    turbo: 'command 5 after 100ms of loop work; full Euler 14, expected 837799', results: {} };
for (const [name, checkout] of Object.entries(versions)) {
    const { Interpreter, withInterrupt } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const warmup = new Interpreter(() => {});
    warmup.execute(source.replace('1000000', '1000'));
    warmup.dispose();
    const results = report.results[name] = { checkout, run: [], turbo: [] };
    for (let sample = 0; sample < samples; sample++) {
        for (const mode of sample % 2 ? ['turbo', 'run'] : ['run', 'turbo']) {
            const words = [0, 0, 0];
            let loopStart, checked = -Infinity, switched = false;
            const runtime = new Interpreter(() => {});
            const signal = {
                length: 3,
                load(index) {
                    const now = performance.now();
                    if (runtime.variables.has('Lengths')) loopStart ??= now;
                    if (now - checked >= 25) {
                        checked = now;
                        if (mode === 'turbo' && !switched && loopStart !== undefined && now - loopStart >= 100) {
                            words[2] = 5;
                            switched = true;
                        }
                    }
                    return words[index];
                },
                store(index, value) { words[index] = value; },
                exchange(index, value) { const previous = this.load(index); words[index] = value; return previous; },
                wait() { throw Error('Unexpected pause'); },
            };
            try {
                const start = performance.now();
                withInterrupt(signal, () => runtime.execute(source), mode === 'turbo' ? () => { throw Error('Unexpected pause'); } : undefined);
                results[mode].push(performance.now() - start);
                assert.equal(runtime.variables.get('Answer'), 837799n);
                if (mode === 'turbo') assert(switched);
            } finally { runtime.dispose(); }
        }
        console.error(`${name}: sample ${sample + 1}/${samples}`);
    }
    results.medians = Object.fromEntries(['run', 'turbo'].map(mode =>
        [mode, [...results[mode]].sort((a, b) => a - b)[Math.floor(samples / 2)]]));
}
console.log(JSON.stringify(report, null, 2));
