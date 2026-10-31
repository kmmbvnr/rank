import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';

function run(source: string): RankArray {
    const runtime = new Interpreter();
    try { return runtime.execute(source) as RankArray; } finally { runtime.dispose(); }
}

const range = Array.from({ length: 3000 }, (_, i) => BigInt(i + 1));
const a = range.map(i => i * 1000000000000007n * (i % 2n ? -1n : 1n));
const setup = 'A = (1 to 3000) * 1000000000000007 * (1 - (1 to 3000) mod 2 * 2)\n';
const mod = (x: bigint, m: bigint) => ((x % m) + m) % m;

describe('Int64 sums and residues', () => {
    it('adds and subtracts a wide scalar', () => {
        expect(run(`${setup}A + 4000000000000000000`).items).toEqual(a.map(x => x + 4000000000000000000n));
        expect(run(`${setup}4000000000000000000 - A`).items).toEqual(a.map(x => 4000000000000000000n - x));
    });
    it('adds two wide arrays and mods by an Int32 scalar', () => {
        expect(run(`${setup}A + A`).items).toEqual(a.map(x => x + x));
        expect(run(`${setup}(A + A) mod 33554393`).items).toEqual(a.map(x => mod(x + x, 33554393n)));
        expect(run(`${setup}A mod 1000003`).items).toEqual(a.map(x => mod(x, 1000003n)));
    });
    it('keeps overflow beyond Int64 exact', () => {
        const wide = `${setup}A * 1000000 + 9000000000000000000`;
        expect(run(wide).items).toEqual(a.map(x => x * 1000000n + 9000000000000000000n));
    });
});
