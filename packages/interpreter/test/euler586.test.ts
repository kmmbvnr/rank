import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/586_binaryquadraticform.ra', import.meta.url), 'utf8');

function run(n: number, r: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${n}`, `--r=${r}`] });
    try {
        runtime.execute(source);
        return answerOf(runtime);
    } finally { runtime.dispose(); }
}

// Count the forms directly without using prime factors or divisor counts.
function brute(n: number, r: number): bigint {
    const counts = new Uint16Array(n + 1);
    for (let a = 2; a * a + 3 * a + 1 <= n; a++) {
        for (let b = 1; b < a; b++) {
            const value = a * a + 3 * a * b + b * b;
            if (value > n) break;
            counts[value]++;
        }
    }
    let answer = 0;
    for (const count of counts) if (count === r) answer++;
    return BigInt(answer);
}

describe.each([true, false])('Euler 586 (compilation=%s)', compilation => {
    it.each([[0, 4], [10, 1], [11, 1], [121, 1], [209, 2], [1000, 2], [5000, 3],
        [100000, 4], [100000, 6], [100000, 41], [6000000, 1]])('matches direct forms at N=%s R=%s', (n, r) => {
        expect(run(n, r, compilation)).toBe(brute(n, r));
    });
    it('matches the larger statement example', () => expect(run(100000000, 6, compilation)).toBe(59517n));
    it('keeps the full answer', () => expect(run(1000000000000000, 40, compilation)).toBe(82490213n));
});
