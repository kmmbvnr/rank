// Build first. Compare an older checkout with --runtime=/absolute/checkout --legacy.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = process.argv.find(arg => arg.startsWith('--runtime='))?.slice(10) ?? resolve(import.meta.dirname, '..');
const { Interpreter, isRankArray } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const legacy = process.argv.includes('--legacy');
const runtime = new Interpreter();
runtime.execute('use sequences\nT = ((1 to 20000) reshape 1000 20) * 1.5\nfun A plus B\n return A + B\nend');

const cases = [
    ['reduce-symbol', 'T reduce +'],
    ['reduce-rank-symbol', 'T reduce + rank 1'],
    ['reduce-function', 'T reduce plus'],
    ['scan-axis-symbol', 'T scan + axis 0'],
    ['scan-axis-function', 'T scan plus axis 0'],
];
if (!legacy) cases.push(
    ['reduce-rank-function', 'T reduce plus rank 1'],
    ['reduce-axis-symbol', 'T reduce + axis 1'],
    ['reduce-axis-function', 'T reduce plus axis 1'],
    ['scan-axis-seed-symbol', 'T scan + axis 0 with 0.0'],
    ['scan-axis-seed-function', 'T scan plus axis 0 with 0.0'],
);
function checksum(value) {
    const items = isRankArray(value) ? value.items : [value];
    return [isRankArray(value) ? [...value.shape] : [], items.length, items.reduce((sum, x) => sum + Number(x), 0)];
}
// Independent arithmetic oracles, including every prefix, rather than a prior run's result.
const total = 1.5 * 20000 * 20001 / 2;
let prefixes = 0;
for (let row = 0; row < 1000; row++) for (let column = 1; column <= 20; column++) {
    prefixes += 1.5 * ((row + 1) * column + 20 * row * (row + 1) / 2);
}
for (const [name, expression] of cases) {
    const scan = name.startsWith('scan');
    const ranked = name.includes('rank') || name.startsWith('reduce-axis');
    const seeded = name.includes('seed');
    const expected = scan ? [[1000 + Number(seeded), 20], 20000 + Number(seeded) * 20, prefixes]
        : ranked ? [[1000], 1000, total] : [[], 1, total];
    const milliseconds = [];
    for (let round = 0; round < 10; round++) {
        const start = performance.now();
        const result = runtime.execute(expression);
        // Force deferred cells inside the timed region, then verify outside it.
        if (isRankArray(result)) void result.items;
        const elapsed = performance.now() - start;
        assert.deepEqual(checksum(result), expected, name);
        if (round >= 3) milliseconds.push(elapsed);
    }
    milliseconds.sort((a, b) => a - b);
    console.log(JSON.stringify({ name, medianMs: Number(milliseconds[3].toFixed(3)), checksum: expected }));
}
runtime.dispose();
