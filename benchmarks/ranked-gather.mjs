// npm run build && node benchmarks/ranked-gather.mjs [side=1000] [vector workaround direct]
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';
import { typedArray } from '../packages/interpreter/out/array-storage.js';

const side = Number(process.argv[2] ?? 1000);
assert(Number.isSafeInteger(side) && side > 0);
const count = side * side;
const source = BigInt64Array.from({ length: 10007 }, (_, i) => BigInt(i * 3));
const indices = BigInt64Array.from({ length: count }, (_, i) => BigInt((i * 17) % source.length));
const programs = {
    vector: 'R = A Flat',
    workaround: `R = (A (Ix reshape ${count})) reshape ${side} ${side}`,
    direct: 'R = A Ix',
};
const modes = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(programs);
assert(modes.every(mode => Object.hasOwn(programs, mode)));
const samples = [];
for (let round = 0; round < 6; round++) {
    for (const mode of modes) {
        const runtime = new Interpreter(() => {});
        try {
            runtime.variables.set('A', typedArray(source.slice()));
            runtime.variables.set('Ix', typedArray(indices.slice(), [side, side]));
            runtime.variables.set('Flat', typedArray(indices.slice()));
            runtime.execute('use sequences');
            // Include selection validation, storage and full result demand.
            // Input generation and the scalar oracle stay outside the timer.
            const started = performance.now();
            const result = runtime.execute(programs[mode]);
            assert(isRankArray(result));
            const values = result.items;
            const ms = performance.now() - started;
            assert.deepEqual(result.shape, mode === 'vector' ? [count] : [side, side]);
            let checksum = 0n;
            for (let i = 0; i < count; i++) {
                assert.equal(values[i], source[Number(indices[i])]);
                checksum += values[i];
            }
            if (round > 0) samples.push({ mode, ms, checksum: String(checksum) });
        } finally { runtime.dispose(); }
    }
}
for (const mode of modes) {
    const selected = samples.filter(sample => sample.mode === mode);
    const times = selected.map(sample => sample.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ mode, side, node: process.version,
        samplesMs: selected.map(sample => +sample.ms.toFixed(2)),
        medianMs: +times[2].toFixed(2), checksum: selected[0].checksum }));
}
