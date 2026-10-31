import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';

function run(source: string): RankArray {
    const runtime = new Interpreter();
    try { return runtime.execute(source) as RankArray; } finally { runtime.dispose(); }
}

const N = 3000n;
const range = Array.from({ length: Number(N) }, (_, i) => BigInt(i + 1));
const exact = (a: bigint[], b: bigint[], m: bigint) => a.map((x, i) => ((x * b[i]) % m + m) % m);
const setup = 'A = (1 to 3000) * 333331 + 7\nB = 0 - (1 to 3000) * 299977\n';
const a = range.map(i => i * 333331n + 7n), b = range.map(i => -i * 299977n);

describe('product under mod', () => {
    it('reduces each product of integer arrays', () => {
        const m = 1000000007n;
        expect(run(`${setup}A * B mod ${m}`).items).toEqual(exact(a, b, m));
    });
    it('keeps the exact result for a modulus beyond 2^30', () => {
        const m = 2147483648n;
        expect(run(`${setup}A * B mod ${m}`).items).toEqual(exact(a, b, m));
    });
    it('still reports a zero modulus', () => {
        expect(() => run(`${setup}C = A * B mod 0\nC`)).toThrow();
    });
});
