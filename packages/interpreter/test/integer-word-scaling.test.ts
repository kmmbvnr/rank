import { describe, expect, it } from 'vitest';
import { RuntimeDiagnostics, isRankArray } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/integer-array-kernel.js';
import { withDemandBudget } from '../src/interrupt.js';

const min = -(1n << 63n), max = (1n << 63n) - 1n;
const divide = (a: bigint, b: bigint) => { const q = a / b, r = a % b; return r < 0n ? q - 1n : q; };
function check(values: bigint[], factor: bigint, operation: '*' | '//', reverse = false) {
    const source = typedArray(BigInt64Array.from(values)), diagnostics = new RuntimeDiagnostics();
    const result = diagnostics.run(() => mapStoredIntegers(reverse ? factor : source, reverse ? source : factor, operation));
    expect(isRankArray(result!)).toBe(true);
    expect([...result!.items]).toEqual(values.map(value => operation === '*' ? value * factor : divide(value, factor)));
    expect([...source.items]).toEqual(values);
    return diagnostics;
}
describe('exact integer word scaling', () => {
    it.each([0, 1, 14, 31, 32, 52, 62, 63, 64])('matches signed BigInt arithmetic through shift %s', shift => {
        const factor = 1n << BigInt(shift);
        const values = [min, min + 1n, -(1n << 53n) - 1n, -32769n, -1n, 0n, 1n, 32769n, (1n << 53n) + 1n, max];
        check(values, factor, '//');
        check(values, factor, '*');
        check(values, factor, '*', true);
    });
    it.each([1, 14, 31, 32, 52, 62, 63])('keeps fitting products on the word path at shift %s', shift => {
        const bits = BigInt(shift), values = [min >> bits, -1n, 0n, max >> bits];
        const d = check(values, 1n << bits, '*');
        expect(d.integerWordScalings).toBe(1);
    });
    it('streams wide positive and negative quotients without boxing', () => {
        expect(check([min, min + 1n, -1n, 0n, 1n, max], 16384n, '//').integerWordScalings).toBe(1);
    });
    it('keeps budgeted evaluation on its existing path', () => {
        let diagnostics: RuntimeDiagnostics | undefined;
        withDemandBudget(1000, () => { diagnostics = check([min + 1n, max], 16384n, '//'); });
        expect(diagnostics!.integerWordScalings).toBe(0);
    });
    it('keeps non-power and negative factors exact', () => {
        for (const factor of [3n, -2n, -(1n << 63n)]) {
            const source = typedArray(new BigInt64Array([min, -7n, 0n, 7n, max]));
            const result = mapStoredIntegers(source, factor, '*')!;
            expect([...result.items]).toEqual([...source.items].map(value => (value as bigint) * factor));
        }
    });
});

it('preserves matrix shape while scaling stored integer cells', () => {
    const values = [-(1n << 42n), -1n, 0n, 1n, (1n << 42n) - 1n, 1n << 42n];
    const matrix = typedArray(BigInt64Array.from(values), [2, 3]), diagnostics = new RuntimeDiagnostics();
    const result = diagnostics.run(() => mapStoredIntegers(matrix, 16384n, '*'))!;
    expect(result.shape).toEqual([2, 3]);
    expect([...result.items]).toEqual(values.map(value => value * 16384n));
    expect([...matrix.items]).toEqual(values);
    expect(diagnostics.integerWordScalings).toBe(1);
});

it('discards a fitting private prefix when a later product exceeds Int64', () => {
    expect(check([1n << 40n, -(1n << 40n), max], 16384n, '*').integerWordScalings).toBe(0);
});
it.skipIf(typeof SharedArrayBuffer === 'undefined')('retains ordinary reads for shared Int64 memory', () => {
    const cells = new BigInt64Array(new SharedArrayBuffer(16));
    cells[0] = min + 1n; cells[1] = max;
    const source = typedArray(cells), diagnostics = new RuntimeDiagnostics();
    const result = diagnostics.run(() => mapStoredIntegers(source, 16384n, '//'))!;
    expect([...result.items]).toEqual([divide(min + 1n, 16384n), divide(max, 16384n)]);
    expect(diagnostics.integerWordScalings).toBe(0);
});
