// npm run build && node benchmarks/choose-sequences.mjs [size]
import assert from 'node:assert/strict';
import { Interpreter } from '../packages/interpreter/out/index.js';

const size = Number(process.argv[2] ?? 100000);
assert(Number.isSafeInteger(size) && size > 0);
let expected = 0n;
for (let value = 1n; value <= BigInt(size); value++) {
    expected += value % 2n === 0n ? value / 2n : value;
}
const sources = {
    array: `Q = (1 to ${size}) copy\nE = Q mod 2 equal 0\nH = E choose (Q // 2) (Q + 0)\nH sum`,
    copied: `Q' = 1 to ${size}\nE = (Q mod 2 equal 0) copy\nH = E choose ((Q // 2) copy) ((Q + 0) copy)\nH sum`,
    lazy: `Q' = 1 to ${size}\nE' = Q mod 2 equal 0\nH = E choose (Q // 2) (Q + 0)\nH sum`,
};
for (const [name, source] of Object.entries(sources)) {
    const milliseconds = [];
    for (let round = 0; round < 8; round++) {
        const runtime = new Interpreter();
        try {
            const start = performance.now();
            const result = runtime.execute(`use sequences\nuse numbers\n${source}`);
            const elapsed = performance.now() - start;
            assert.equal(result, expected);
            if (round >= 3) milliseconds.push(elapsed);
        } finally { runtime.dispose(); }
    }
    milliseconds.sort((a, b) => a - b);
    console.log(JSON.stringify({ name, size, checksum: String(expected), node: process.version,
        medianMs: milliseconds[2], milliseconds }));
}
