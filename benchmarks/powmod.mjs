// npm run build && node benchmarks/powmod.mjs [--checkout=/path/to/baseline]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const match = /^--(checkout|size|samples|worker)=(.+)$/.exec(argument);
    assert(match, `Unknown argument: ${argument}`);
    return [match[1], match[2]];
}));
const checkout = resolve(options.checkout ?? fileURLToPath(new URL('..', import.meta.url)));
const size = Number(options.size ?? 12344318);
const samples = Number(options.samples ?? 3);
assert(Number.isSafeInteger(size) && size > 0);
assert(Number.isSafeInteger(samples) && samples > 0);

if (options.worker) {
    const { Interpreter, isRankArray } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter();
    try {
        const setup = performance.now();
        runtime.execute(`use numbers\nuse sequences\nMs = (2 to ${size + 1}) copy`);
        const setupMs = performance.now() - setup;
        const start = performance.now();
        const result = runtime.execute('Pw = (Ms - 1) Ms 135707531 powmod\nPw');
        assert(isRankArray(result));
        const elapsedMs = performance.now() - start;
        // The eager binding above completes the result. Exporting .items also
        // boxes typed storage into a host-facing JS array; measure it separately.
        const exportStart = performance.now();
        const items = result.items;
        const exportMs = performance.now() - exportStart;
        assert.equal(items.length, size);
        // Independent BigInt oracle, outside the timed region.
        let checksum = 0n;
        for (let sample = 0; sample < 129; sample++) {
            const index = Math.floor(sample * (size - 1) / 128);
            const m = BigInt(index + 2);
            let base = m - 1n, power = m, expected = 1n;
            while (power) {
                if (power % 2n) expected = expected * base % 135707531n;
                base = base * base % 135707531n;
                power /= 2n;
            }
            assert.equal(items[index], expected, `index ${index}`);
            checksum += expected;
        }
        console.log(JSON.stringify({ setupMs, elapsedMs, exportMs, checksum: String(checksum) }));
    } finally { runtime.dispose(); }
} else {
    const runs = [];
    for (let sample = 0; sample < samples; sample++) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker=true',
            `--checkout=${checkout}`, `--size=${size}`], { encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr || child.stdout);
        const run = JSON.parse(child.stdout);
        runs.push(run);
        console.log(JSON.stringify({ sample: sample + 1, ...run }));
    }
    assert(runs.every(run => run.checksum === runs[0].checksum));
    const sorted = runs.map(run => run.elapsedMs).sort((a, b) => a - b);
    console.log(JSON.stringify({ checkout, node: process.version, cpu: cpus()[0]?.model, size,
        medianMs: sorted[Math.floor(sorted.length / 2)], runs }, null, 2));
}
