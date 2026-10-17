// npx tsc -b tsconfig.build.json && node benchmarks/mask-selection.mjs
// Include the full Euler 60 demo with --euler (three fresh processes).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { ownedArray } from '../packages/interpreter/out/array-storage.js';
import { collectionSize } from '../packages/interpreter/out/collection-size.js';
import { maskSelection } from '../packages/interpreter/out/value-selection.js';

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (process.argv[2] === '--worker') {
    const mode = process.argv[3];
    if (mode === 'euler') {
        const runtime = new Interpreter(() => {});
        try {
            const source = readFileSync(new URL('../demos/euler/060_primepairs.ra', import.meta.url), 'utf8');
            const start = performance.now();
            runtime.execute(source);
            assert.equal(runtime.variables.get('Answer'), 26033n);
            console.log(JSON.stringify({ milliseconds: performance.now() - start, answer: '26033' }));
        } finally { runtime.dispose(); }
    } else {
        const size = 100_000;
        const source = ownedArray(Array(size).fill(1n));
        const flags = Array.from({ length: size }, (_, i) => mode === 'dense' || i % 1000 === 0);
        const mask = ownedArray(flags);
        const kept = mode === 'dense' ? size : size / 1000;
        const samples = { construction: [], length: [], traversal: [] };
        for (let round = 0; round < 9; round++) {
            let start = performance.now();
            const selected = maskSelection(source, mask);
            const construction = performance.now() - start;
            start = performance.now();
            for (let i = 0; i < 100; i++) assert.equal(collectionSize(selected).length(), BigInt(kept));
            const length = performance.now() - start;
            start = performance.now();
            for (let i = 0; i < 10; i++) {
                let sum = 0n;
                for (const value of selected.plan.iterate()) sum += value;
                assert.equal(sum, BigInt(kept));
            }
            const traversal = performance.now() - start;
            if (round >= 2) {
                samples.construction.push(construction);
                samples.length.push(length);
                samples.traversal.push(traversal);
            }
        }
        console.log(JSON.stringify({ size, kept, lengthReads: 100, traversals: 10,
            samples, medianMs: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, median(values)])) }));
    }
} else {
    const cases = process.argv.includes('--euler') ? ['sparse', 'dense', 'euler'] : ['sparse', 'dense'];
    const results = {};
    for (const name of cases) {
        const samples = [];
        for (let run = 0; run < (name === 'euler' ? 3 : 1); run++) {
            const worker = spawnSync(process.execPath, [import.meta.filename, '--worker', name], { encoding: 'utf8' });
            assert.equal(worker.status, 0, worker.stderr);
            samples.push(JSON.parse(worker.stdout));
        }
        results[name] = name === 'euler'
            ? { samples, medianMs: median(samples.map(sample => sample.milliseconds)) } : samples[0];
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, results }, null, 2));
}
