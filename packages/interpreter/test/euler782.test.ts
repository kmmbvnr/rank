import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/782_distinctrowscolumns.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler782-original.ra', import.meta.url), 'utf8');
// Enumerate every binary matrix; no templates or group-size quadratic forms.
function exhaustive(size: number): bigint {
    const best = Array(size * size + 1).fill(Infinity), mask = (1 << size) - 1;
    for (let matrix = 0; matrix < 2 ** (size * size); matrix++) {
        const lines = new Set<number>();
        let ones = 0;
        for (let bits = matrix; bits; bits &= bits - 1) ones++;
        for (let row = 0; row < size; row++) {
            lines.add(matrix >>> (row * size) & mask);
            let column = 0;
            for (let i = 0; i < size; i++) column |= (matrix >>> (i * size + row) & 1) << i;
            lines.add(column);
        }
        best[ones] = Math.min(best[ones], lines.size);
    }
    return BigInt(best.reduce((a, b) => a + b, 0));
}
function run(code: string, size: number, compilation: boolean): unknown {
    const r = new Interpreter(() => {}, { compilation });
    try {
        r.execute(code.replace('arg Size integer = 10000', `Size = ${size}`));
        return answerOf(r);
    } finally { r.dispose(); }
}
for (const compilation of [false, true]) describe(`Euler 782 (compiled=${compilation})`, () => {
    it.each([1, 2, 3, 4])('matches all binary matrices at Size=%i', size => {
        expect(run(source, size, compilation)).toBe(exhaustive(size));
    });
    it.each([[5, 64n], [10, 274n], [20, 1150n]])('matches the published C(%i)', (size, expected) => {
        expect(run(source, Number(size), compilation)).toBe(expected);
    });
    it.each([31, 64, 101])('matches original integer flags at Size=%i', size => {
        expect(run(source, size, compilation)).toBe(run(original, size, compilation));
    });
});
