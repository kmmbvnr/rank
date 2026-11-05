// Research only: no statement integration, contracts, alias publication or budgets.
// Validate all pure keys first; reduce RHS into private state before any write.
import assert from 'node:assert/strict';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';
import { prepareKeyedTensorReader } from '../packages/interpreter/out/jit/tensor-map.js';
import { reduceIntegerUpdates } from '../packages/interpreter/out/array-storage.js';
const [mode = 'stream', countText = '500000'] = process.argv.slice(2);
const count = Number(countText), size = 1024;
const runtime = new Interpreter(() => {}, { compilation: false });
try {
    runtime.execute(`use sequences\nT = 0 till ${count} array\nKeys' = (T * 17) mod ${size}\nValues' = T ** 2 + 3\nH = array shape ${size} fill 0`);
    const start = performance.now();
    let actual;
    if (mode === 'ordinary') {
        runtime.execute('H Keys += Values .accumulate');
        actual = runtime.variables.get('H').items;
    } else {
        const keys = runtime.execute('Keys'), values = runtime.execute('Values');
        assert(isRankArray(keys) && isRankArray(values));
        const keyAt = prepareKeyedTensorReader(keys), valueAt = prepareKeyedTensorReader(values);
        assert(keyAt && valueAt);
        for (let i = 0; i < count; i++) {
            const key = keyAt(i);
            assert(key >= 0n && key < BigInt(size));
        }
        const updates = reduceIntegerUpdates(size, count, i => Number(keyAt(i)), valueAt, false);
        actual = Array(size).fill(0n);
        updates.offsets.forEach((offset, i) => actual[offset] += updates.operands[i]);
    }
    const ms = performance.now() - start;
    const rssMiB = process.resourceUsage().maxRSS / 1024;
    const expected = Array(size).fill(0n);
    for (let i = 0n; i < BigInt(count); i++) expected[Number(i * 17n % BigInt(size))] += i * i + 3n;
    assert.deepEqual(Array.from(actual), expected);
    console.log(JSON.stringify({ mode, count, ms, rssMiB, answer: String(expected.reduce((a, b) => a + b)) }));
} finally { runtime.dispose(); }
