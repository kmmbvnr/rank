// Compare all nullities, not only the final modular sum.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..');
const { Interpreter } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const { readArrayItem } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/array-storage.js')));
const original = readFileSync(new URL('./fixtures/euler707-original.ra', import.meta.url), 'utf8');
const source = readFileSync(resolve(root, 'demos/euler/707_lightsout.ra'), 'utf8');
function run(text, width, count, compilation = true, prime = 1000000007) {
    text = text.replace('arg Width integer = 199', `Width = ${width}`)
        .replace('arg Count integer = 199', `Count = ${count}`)
        .replace('arg Prime integer = 1000000007', `Prime = ${prime}`);
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(text);
        const value = runtime.variables.get('Nullity');
        return { answer: String((runtime.variables.get('Answer') ?? runtime.lastResult)),
            nullities: Array.from({ length: count }, (_, i) => Number(readArrayItem(value, i))) };
    } finally { runtime.dispose(); }
}
function power(exponent, modulus) {
    let result = 1n, base = 2n;
    for (; exponent; exponent >>= 1n, base = base * base % modulus) {
        if (exponent & 1n) result = result * base % modulus;
    }
    return result % modulus;
}
// Independent oracle: build the complete w*h toggle matrix and eliminate it.
// No Fibonacci polynomial identities or width-sized transfer matrices.
function gridNullity(width, height) {
    const size = width * height;
    const rows = Array.from({ length: size }, (_, i) => {
        let row = 1n << BigInt(i);
        if (i % width) row |= 1n << BigInt(i - 1);
        if (i % width + 1 < width) row |= 1n << BigInt(i + 1);
        if (i >= width) row |= 1n << BigInt(i - width);
        if (i + width < size) row |= 1n << BigInt(i + width);
        return row;
    });
    let rank = 0;
    for (let column = 0; column < size; column++) {
        const bit = 1n << BigInt(column);
        const pivot = rows.findIndex((row, i) => i >= rank && (row & bit));
        if (pivot < 0) continue;
        [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
        for (let row = rank + 1; row < size; row++) if (rows[row] & bit) rows[row] ^= rows[rank];
        rank++;
    }
    return size - rank;
}
function gridOracle(width, count, prime = 1000000007) {
    let first = 1, second = 1, answer = 0n;
    const nullities = [];
    for (let step = 0; step < count; step++) {
        if (step >= 2) [first, second] = [second, first + second];
        const nullity = gridNullity(width, second);
        nullities.push(nullity);
        answer = (answer + power(BigInt(width * second - nullity), BigInt(prime))) % BigInt(prime);
    }
    return { answer: String(answer), nullities };
}
let differential = 0, independent = 0;
for (const width of [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 31, 32, 33, 63, 64, 65, 127, 128, 129, 199]) {
    for (const count of [2, 3, 7]) {
        const expected = run(original, width, count);
        if (width <= 6) { assert.deepEqual(expected, gridOracle(width, count)); independent++; }
        for (const compilation of [true, false]) {
            assert.deepEqual(run(source, width, count, compilation), expected, `${width} x ${count}, compilation=${compilation}`);
            differential++;
        }
    }
}
for (const prime of [3, 5, 7, 17, 101]) for (const compilation of [true, false]) {
    const expected = gridOracle(5, 7, prime);
    assert.deepEqual(run(source, 5, 7, compilation, prime), expected);
    independent++;
}
for (const [width, count] of [[0, 0], [0, 1], [1, 0], [1, 1], [3, 0], [3, 1]]) {
    for (const compilation of [true, false]) {
        assert.deepEqual(run(source, width, count, compilation), gridOracle(width, count));
        independent++;
    }
}
for (const [width, count] of [[-1, 2], [3, -1]]) assert.throws(() => run(source, width, count), { rankKind: 'DomainError' });
const recorded = JSON.parse(readFileSync(new URL('./results/euler707-step1-mac.jsonl', import.meta.url), 'utf8'));
const full = { answer: recorded.answer, nullities: recorded.nullities };
for (const compilation of [true, false]) assert.deepEqual(run(source, 199, 199, compilation), full);
if (process.argv.includes('--full-original')) assert.deepEqual(run(original, 199, 199), full);
console.log(JSON.stringify({ differential, independent, fullInput: true,
    fullOriginal: process.argv.includes('--full-original'), answer: full.answer,
    node: process.version, arch: process.arch }));
