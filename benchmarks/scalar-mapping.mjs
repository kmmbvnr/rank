// Run after npm run build. Use --root=/path/to/built/checkout --baseline
// to measure an older checkout where whole-array real conversion is unsupported.
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const root = resolve(args.find(arg => arg.startsWith('--root='))?.slice(7)
    ?? fileURLToPath(new URL('..', import.meta.url)));
const cases = [
    ...args.includes('--baseline') ? [] : [['real', 0.25]],
    ['real rank 0', 0.25], ['sin', Math.sin(0.25)], ['sin rank 0', Math.sin(0.25)],
    ['floor', 0n], ['ceil', 1n],
];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (args.includes('--sample')) {
    const { Interpreter, isRankArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
    const runtime = new Interpreter();
    const results = {};
    try {
        runtime.execute('use numbers\nuse sequences\nA = array shape 256 256 fill 0.25');
        for (const [operation, expected] of cases) {
            const times = [];
            let checksum;
            for (let repeat = 0; repeat < 7; repeat++) {
                const start = performance.now();
                const value = runtime.execute(`A ${operation} copy`);
                const elapsed = performance.now() - start;
                assert.ok(isRankArray(value));
                assert.deepEqual(value.shape, [256, 256]);
                const items = value.items;
                assert.equal(items.length, 65536);
                assert.ok(items.every(item => Object.is(item, expected)));
                checksum = items.reduce((sum, item) => sum + Number(item), 0);
                if (repeat >= 2) times.push(elapsed);
            }
            results[operation] = { medianMs: median(times), checksum };
        }
    } finally { runtime.dispose(); }
    console.log(JSON.stringify(results));
} else {
    const samples = Array.from({ length: 3 }, () => {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args, '--sample'], { encoding: 'utf8' });
        if (child.status !== 0) throw Error(child.stderr || child.stdout);
        return JSON.parse(child.stdout);
    });
    console.log(JSON.stringify({ node: process.version, elements: 65536, processes: 3,
        warmupsPerCase: 2, measurementsPerCase: 5,
        results: Object.fromEntries(cases.map(([name]) => [name, {
            medianMs: median(samples.map(sample => sample[name].medianMs)),
            checksum: samples[0][name].checksum,
            processMediansMs: samples.map(sample => sample[name].medianMs),
        }])) }, null, 2));
}
