import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/414_kaprekar.ra', import.meta.url), 'utf8');
function solve(first: number, last: number, compilation: boolean, modulus = '1000000000000000000') {
    const runtime = new Interpreter(() => {}, { compilation,
        args: [`--first=${first}`, `--last=${last}`, `--mod=${modulus}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        return { answer: answerOf(runtime), diagnostics };
    } finally { runtime.dispose(); }
}

// Enumerate sorted digit multisets and count their permutations. Compute the
// Kaprekar step by subtraction in base b, independently of the transition
// order-statistic formula and the closed multiplicity formula in the demo.
function oracle(base: number): bigint {
    const third = base / 3, fixed = 2 * third * base + third;
    const distances = new Map([[fixed, 1]]);
    function distance(digits: number[]): number {
        const sorted = [...digits].sort((a, b) => a - b);
        const key = (sorted[4] - sorted[0]) * base + sorted[3] - sorted[1];
        if (distances.has(key)) return distances.get(key)!;
        const ascending = sorted.reduce((n, d) => n * base + d, 0);
        const descending = sorted.reduceRight((n, d) => n * base + d, 0);
        let value = descending - ascending;
        const next = Array.from({ length: 5 }, () => { const d = value % base; value = Math.floor(value / base); return d; });
        const result = 1 + distance(next);
        distances.set(key, result);
        return result;
    }
    const factorial = [1, 1, 2, 6, 24, 120];
    let total = 0n;
    for (let a = 0; a < base; a++) for (let b = a; b < base; b++)
        for (let c = b; c < base; c++) for (let d = c; d < base; d++) for (let e = d; e < base; e++) {
            if (a === e) continue;
            const digits = [a, b, c, d, e], counts = new Map<number, number>();
            for (const digit of digits) counts.set(digit, (counts.get(digit) ?? 0) + 1);
            let permutations = 120;
            for (const count of counts.values()) permutations /= factorial[count];
            total += BigInt(permutations * distance(digits));
        }
    return total - 1n; // The constant itself needs zero steps.
}
const small = [15, 21, 27].map(oracle);

describe.each([false, true])('Euler 414 (compilation=%s)', compilation => {
    it('matches independent five-digit multiset counts', () => {
        for (let k = 2; k <= 4; k++) expect(solve(k, k, compilation).answer).toBe(small[k - 2]);
    });
    it('preserves statement and larger fixture values', () => {
        expect(solve(18, 18, compilation).answer).toBe(400668930299n);
        expect(solve(40, 40, compilation).answer).toBe(40372025866559n);
        expect(solve(100, 100, compilation).answer).toBe(9032180012980999n);
    }, 90000);
    it('handles empty ranges, small moduli and multiple bases', () => {
        expect(solve(2, 1, compilation).answer).toBe(0n);
        expect(solve(2, 2, compilation, '1').answer).toBe(0n);
        expect(solve(40, 40, compilation, '1000000').answer).toBe(866559n);
        expect(solve(2, 4, compilation).answer).toBe(small.reduce((a, b) => a + b));
    });
});
