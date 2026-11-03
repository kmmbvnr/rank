import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';

// Actual card subsets: one bit per card, grouped by suit.
const ranks = 4, total = 1 << (ranks * 4);
const good = new Uint8Array(total), counts = Array(17).fill(0);
for (let a = 0; a < ranks; a++) {
    for (let b = 0; b < ranks; b++) {
        for (let c = 0; c < ranks; c++) {
            for (let d = 0; d < ranks; d++) {
                if (new Set([a, b, c, d]).size === 4) {
                    good[(1 << a) | (1 << (ranks + b))
                        | (1 << (2 * ranks + c)) | (1 << (3 * ranks + d))] = 1;
                }
            }
        }
    }
}
// Every superset of a Badugi contains a Badugi.
for (let bit = 1; bit < total; bit *= 2) {
    for (let mask = 0; mask < total; mask++) {
        if (mask & bit) good[mask] |= good[mask ^ bit];
    }
}
for (let mask = 0; mask < total; mask++) {
    if (good[mask]) counts[mask.toString(2).replaceAll('0', '').length]++;
}
const rows = [];
for (const variant of ['original', 'compact', 'array']) {
    for (const compilation of [false, true]) {
        const path = new URL(`./euler369-${variant}.ra`, import.meta.url);
        let source = readFileSync(path, 'utf8')
            .replace(/Answer = Ranks badugi Max\nAnswer print/, '');
        source += `
for N in 0 to 16
  4 16 N hands print
end
13 5 4 hands print
13 5 5 hands print
`;
        const output = [];
        const runtime = new Interpreter(text => output.push(Number(text)), {compilation});
        const start = performance.now();
        try {
            runtime.execute(source);
            assert.deepEqual(output, [...counts, 17160, 514800]);
            rows.push({variant, compilation, ms: performance.now() - start,
                cases: output.length, counts});
        } finally {
            runtime.dispose();
        }
    }
}
console.log(JSON.stringify(rows, null, 2));
