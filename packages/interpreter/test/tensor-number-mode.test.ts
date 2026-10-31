import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    try { return formatValue(runtime.execute('use sequences\nuse numbers\n' + source)!); } finally { runtime.dispose(); }
}
function asg(expr: string): string { return `Rs = ${expr}\nRs`; }
function failure(source: string): string {
    try { run(source); } catch (error) { return (error as Error).message; }
    return '';
}

const N = 3000;
const ks = Array.from({ length: N }, (_, i) => BigInt(i + 1));
const floorDiv = (a: bigint, b: bigint) => { const q = a / b; return (a % b !== 0n) && ((a < 0n) !== (b < 0n)) ? q - 1n : q; };
const floorMod = (a: bigint, b: bigint) => a - floorDiv(a, b) * b;
const join = (cells: bigint[]) => cells.join(' ');
const T = `Tn = ((1 to ${N}) * 7) copy\n`;

describe('checked Number integer kernels', () => {
    it('agrees with exact arithmetic on signed quotients and remainders', () => {
        const t = ks.map(k => k * 7n);
        for (const d of [5n, -5n, 1000n]) {
            const ds = d < 0n ? `(0 - ${-d})` : `${d}`;
            expect(run(`${T}${asg(`((Tn - 9000) // ${ds}) * 3 + 1`)}`)).toBe(join(t.map(a => floorDiv(a - 9000n, d) * 3n + 1n)));
            expect(run(`${T}${asg(`(Tn - 9000) mod ${ds}`)}`)).toBe(join(t.map(a => floorMod(a - 9000n, d))));
        }
    });
    it('falls back to exact results past 2 ** 53 and widens the output', () => {
        const big = 3_000_000_000_000n;
        expect(run(`${T}${asg(`Tn * ${big} * 1000`)}`)).toBe(join(ks.map(k => k * 7n * big * 1000n)));
        expect(run(`${T}${asg(`(Tn * 4000000000000 * 1000) // 1000`)}`)).toBe(join(ks.map(k => k * 7n * 4_000_000_000_000n)));
    });
    it('reads Int64 cells and leaves unsafe ones to the exact kernel', () => {
        const wide = `Wd = ((1 to ${N}) * 4400000000000000) copy\n`;
        expect(run(`${wide}${asg(`Wd + 1`)}`)).toBe(join(ks.map(k => k * 4_400_000_000_000_000n + 1n)));
        expect(run(`${wide}${asg(`Wd mod 1000`)}`)).toBe(join(ks.map(k => floorMod(k * 4_400_000_000_000_000n, 1000n))));
    });
    it('keeps zero divisors and gather ranges as exact errors', () => {
        expect(failure(`${T}${asg(`Tn // (Tn - Tn)`)}`)).not.toBe('');
        expect(failure(`${T}${asg(`Tn mod (Tn - Tn)`)}`)).not.toBe('');
        expect(failure(`${T}${asg(`Tn (Tn)`)}`)).not.toBe('');
    });
    it('gathers through an integer selector', () => {
        const t = ks.map(k => k * 7n);
        expect(run(`${T}Ix = ((1 to ${N}) mod ${N}) copy\n${asg('Tn Ix + 1')}`)).toBe(join(ks.map(k => t[Number(k % BigInt(N))] + 1n)));
    });
    it('updates a bound array in place from its own cells', () => {
        expect(run(`Ar = (1 to ${N}) copy\nAr = Ar * 3 + 1\nAr = Ar * Ar\nAr`)).toBe(join(ks.map(k => (3n * k + 1n) ** 2n)));
    });
});
