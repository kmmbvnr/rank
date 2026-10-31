import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    try { return formatValue(runtime.execute('use sequences\nuse numbers\n' + source)!); } finally { runtime.dispose(); }
}

const ks = Array.from({ length: 2000 }, (_, i) => BigInt(i + 1));
const join = (cells: (number | bigint | boolean)[]) => cells.join(' ');
const floorDiv = (a: bigint, b: bigint) => { const q = a / b; return (a % b !== 0n) && ((a < 0n) !== (b < 0n)) ? q - 1n : q; };
const floorMod = (a: bigint, b: bigint) => a - floorDiv(a, b) * b;

const W = 'Wd = ((1 to 2000) * 4400000000000 + 12345) copy\n';

describe('wide integer cells', () => {
    it('lists the positions of a flat mask', () => {
        expect(run('Mk = (((1 to 2000) mod 7) equal 0) copy\nMk indices')).toBe(join(ks.flatMap((k, i) => k % 7n === 0n ? [i] : [])));
        expect(run('Mk = ((1 to 2000) greater 5000) copy\nIx = Mk indices\nIx len')).toBe('0');
    });
    it('floors quotients and remainders near the safe-integer limit', () => {
        const wide = ks.map(k => k * 4_400_000_000_000n + 12_345n);
        for (const d of [7n, 1_000_000_007n, -9n, 20_000_000n]) {
            const ds = d < 0n ? `(0 - ${-d})` : `${d}`;
            expect(run(`${W}Wd // ${ds}`)).toBe(join(wide.map(a => floorDiv(a, d))));
            expect(run(`${W}Wd mod ${ds}`)).toBe(join(wide.map(a => floorMod(a, d))));
            expect(run(`${W}(0 - Wd) mod ${ds}`)).toBe(join(wide.map(a => floorMod(-a, d))));
        }
    });
    it('widens Int32 cells once a result needs 64 bits', () => {
        const source = '((1 to 2000) * (1 to 2000) * (1 to 2000)) // 3 * 1000';
        expect(run(source)).toBe(join(ks.map(k => floorDiv(k * k * k, 3n) * 1000n)));
    });
});
