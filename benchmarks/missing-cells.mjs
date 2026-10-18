import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { maskedArray, ownedArray, readArrayItem } from '../packages/interpreter/out/array-storage.js';
import { mapMaskedIntegers } from '../packages/interpreter/out/masked-kernels.js';
import { queryDefault } from '../packages/interpreter/out/query-default.js';
import { columnFromValues, RankArrowTable } from '../packages/interpreter/out/arrow-table.js';
import { MISSING } from '../packages/interpreter/out/value.js';

const size = Number(process.argv[2] ?? 100000);
assert(Number.isSafeInteger(size) && size > 0);
const median = samples => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
function measure(name, fast, reference, check) {
    check(fast(), reference());
    const a = [], b = [];
    for (let run = 0; run < 7; run++) {
        for (const [fn, times] of run % 2 ? [[reference, b], [fast, a]] : [[fast, a], [reference, b]]) {
            const start = performance.now(); fn(); times.push(performance.now() - start);
        }
    }
    console.log(JSON.stringify({ name, size, fastMs: median(a), referenceMs: median(b) }));
}
const cells = Array.from({ length: size }, (_, i) => i % 3 ? BigInt(i) : MISSING);
const bits = new Uint32Array(Math.ceil(size / 32));
for (let i = 0; i < size; i++) if (i % 3) bits[i >>> 5] |= 1 << (i & 31);
const input = maskedArray(BigInt64Array.from(cells, x => x === MISSING ? 0n : x), bits);
measure('integer add', () => mapMaskedIntegers(input, 2n, '+', (a, b) => a + b),
    () => ownedArray(cells.map(x => x === MISSING ? x : x + 2n)),
    (a, b) => assert.deepEqual(a.items, b.items));
const column = columnFromValues('n', cells);
const table = new RankArrowTable(size, [column]);
measure('Arrow nullable column', () => table.columnArray('n'),
    () => ownedArray(Array.from({ length: size }, (_, i) => table.cell(i, 0) ?? MISSING)),
    (a, b) => assert.deepEqual(a.items, b.items));
const keys = ownedArray(Array.from({ length: 100 }, (_, i) => BigInt(i)));
for (const missPercent of [0, 10, 90]) {
    const queries = ownedArray(Array.from({ length: size }, (_, i) => i % 100 < missPercent ? -1n : BigInt(i % 100)));
    measure(`find ${missPercent}% misses`, () => queryDefault('find', keys, queries), () => {
        const result = [];
        for (let i = 0; i < size; i++) {
            const query = readArrayItem(queries, i);
            try {
                const index = keys.items.indexOf(query);
                if (index < 0) throw new Error('missing');
                result.push(BigInt(index));
            } catch { result.push(MISSING); }
        }
        return ownedArray(result);
    }, (a, b) => assert.deepEqual(a.items, b.items));
}
