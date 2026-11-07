import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, formatValue } from '../src/index.js';
import { arrayValues, typedArray, ownedArray, writeArrayCell, derivedArray } from '../src/array-storage.js';
import { prepareRankedMatrixPower } from '../src/ranked-matpow.js';
import { withInterrupt, InterruptedError, withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';
import { native } from '../src/modules/shared.js';
function reference(input: readonly bigint[], power: bigint, modulus: bigint): bigint[] {
    const mod = (x: bigint) => (x % modulus + modulus) % modulus;
    const product = (a: bigint[], b: bigint[]) => [mod(a[0] * b[0] + a[1] * b[2]), mod(a[0] * b[1] + a[1] * b[3]),
        mod(a[2] * b[0] + a[3] * b[2]), mod(a[2] * b[1] + a[3] * b[3])];
    let base = input.map(mod), result = [mod(1n), 0n, 0n, mod(1n)];
    for (let exponent = power; exponent > 0n; exponent >>= 1n, base = product(base, base)) if (exponent & 1n) result = product(result, base);
    return result;
}
const powers = [0n, 1n, 2n, 31n, 32n, 4294967295n, 4294967296n, 4503599627370497n, 9007199254740991n];
for (const compilation of [false, true]) describe(`native modular matrix batches, compilation=${compilation}`, () => {
    it.each([1n, 2n, 65537n, 1000000n, 67108864n])('matches BigInt powers across exponent bits, modulus=%s', modulus => {
        const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
        const matrix = [modulus - 1n, modulus - 1n, -(2n ** 100n) + 3n, 2n ** 110n + 7n];
        runtime.variables.set('Matrix', ownedArray(matrix, [2, 2]));
        runtime.variables.set('Powers', typedArray(BigInt64Array.from(powers)));
        try {
            const actual = diagnostics.run(() => runtime.execute(`use linalg\nMatrix matpow Powers rank 2 0 mod ${modulus}`));
            if (!actual || !isRankArray(actual)) throw Error('expected batch');
            expect(actual.shape).toEqual([powers.length, 2, 2]);
            expect([...arrayValues(actual)]).toEqual(powers.flatMap(power => reference(matrix, power, modulus)));
            expect(diagnostics.nativeModularMatrixPowers).toBe(powers.length);
        } finally { runtime.dispose(); }
    });
    it('broadcasts stored matrices, exponents and varying moduli into one batch', () => {
        const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
        const matrices = [[67108863n, 67108863n, 67108863n, 67108863n], [-5n, 7n, 11n, -13n]];
        const exponents = [0n, 4294967296n, 9007199254740991n], moduli = [1n, 1000000n, 67108864n];
        runtime.variables.set('Matrices', typedArray(BigInt64Array.from(matrices.flat()), [2, 1, 2, 2]));
        runtime.variables.set('Powers', typedArray(BigInt64Array.from(exponents)));
        runtime.variables.set('Mods', typedArray(BigInt64Array.from(moduli), [3, 1, 1]));
        try {
            const actual = diagnostics.run(() => runtime.execute('use linalg\nMatrices matpow Powers rank 2 0 mod Mods'));
            if (!actual || !isRankArray(actual)) throw Error('expected batch');
            expect(actual.shape).toEqual([2, 3, 2, 2]);
            expect([...arrayValues(actual)]).toEqual(matrices.flatMap(matrix => exponents.flatMap((power, i) => reference(matrix, power, moduli[i]))));
            expect(diagnostics.nativeModularMatrixPowers).toBe(6); expect(diagnostics.modularMatrixPowers).toBe(6);
            expect(diagnostics.nativeModularMatrixBatches).toBe(1);
        } finally { runtime.dispose(); }
    });
    it.each([[67108865n, 31n], [2n ** 90n + 7n, 31n], [11n, 9007199254740992n]])('keeps exact fallback beyond native bounds, modulus=%s exponent=%s', (modulus, power) => {
        const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics(), matrix = [5n, -7n, 9n, -11n];
        runtime.variables.set('Matrix', typedArray(BigInt64Array.from(matrix), [2, 2]));
        runtime.variables.set('Powers', typedArray(BigInt64Array.from([power])));
        try {
            const actual = diagnostics.run(() => runtime.execute(`use linalg\nMatrix matpow Powers rank 2 0 mod ${modulus}`));
            if (!actual || !isRankArray(actual)) throw Error('expected batch');
            expect([...arrayValues(actual)]).toEqual(reference(matrix, power, modulus));
            expect(diagnostics.nativeModularMatrixPowers).toBe(0); expect(diagnostics.modularMatrixPowers).toBe(1);
        } finally { runtime.dispose(); }
    });
    it('combines a scalar exponent with per-matrix moduli', () => {
        const matrices = [[1n, 2n, 3n, 4n], [-5n, 7n, 11n, -13n]], moduli = [13n, 17n];
        const plan = prepareRankedMatrixPower(typedArray(BigInt64Array.from(matrices.flat()), [2, 2, 2]), 4294967297n)!;
        const actual = plan.run(typedArray(BigInt64Array.from(moduli), [2, 1, 1]));
        if (!actual || !isRankArray(actual)) throw Error('expected batch');
        expect([...arrayValues(actual)]).toEqual(matrices.flatMap((matrix, i) => reference(matrix, 4294967297n, moduli[i])));
    });
    it('matches varied matrices and exponents with a BigInt oracle', () => {
        let seed = 1299721;
        const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
        const moduli = Array.from({ length: 48 }, (_, i) => i % 3 === 0 ? 67108864n : BigInt(next() % 1000000 + 1));
        const matrices = moduli.map(() => Array.from({ length: 4 }, () => BigInt(next() | 0)));
        const exponents = moduli.map(() => BigInt(next()) * 65536n + BigInt(next() % 65536));
        const plan = prepareRankedMatrixPower(typedArray(BigInt64Array.from(matrices.flat()), [48, 2, 2]), typedArray(BigInt64Array.from(exponents)))!;
        const actual = plan.run(typedArray(BigInt64Array.from(moduli), [48, 1, 1]));
        if (!actual || !isRankArray(actual)) throw Error('expected batch');
        expect([...arrayValues(actual)]).toEqual(matrices.flatMap((matrix, i) => reference(matrix, exponents[i], moduli[i])));
    });
    it('snapshots both matrices and exponents before modulus effects', () => {
        const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
        const matrix = typedArray(new Int32Array([1, 1, 1, 0]), [2, 2]), exponents = typedArray(new Int32Array([0, 5, 10]));
        runtime.variables.set('Matrix', matrix); runtime.variables.set('Powers', exponents);
        let calls = 0;
        runtime.variables.set('change', native('change', 1, () => { calls++; writeArrayCell(matrix, 0, 99n); writeArrayCell(exponents, 1, 1n); return 11n; }));
        try {
            const actual = diagnostics.run(() => runtime.execute('use linalg\nMatrix matpow Powers rank 2 0 mod (0 change)'));
            if (!actual || !isRankArray(actual)) throw Error('expected batch');
            expect([...arrayValues(actual)]).toEqual([0n, 5n, 10n].flatMap(power => reference([1n, 1n, 1n, 0n], power, 11n)));
            expect(calls).toBe(1); expect(diagnostics.nativeModularMatrixPowers).toBe(3);
        } finally { runtime.dispose(); }
    });
});
it('preserves native cancellation, budgets and opaque-reader fallback', () => {
    const matrix = typedArray(new Int32Array([1, 7, 1, 1]), [2, 2]), powers = typedArray(new BigInt64Array(128).fill(1000000000000n));
    const prepared = prepareRankedMatrixPower(matrix, powers)!;
    expect(() => withInterrupt(new Int32Array([1]), () => prepared.run(999983n))).toThrow(InterruptedError);
    expect(formatValue(matrix)).toBe('1 7 1 1');
    expect(() => withDemandBudget(1, () => prepared.run(999983n))).toThrow(DemandBudgetExhausted);
    let reads = 0;
    const opaque = derivedArray([2, 2], [], i => { reads++; return BigInt(i + 1); });
    expect(prepareRankedMatrixPower(opaque, 2n)).toBeUndefined(); expect(reads).toBe(0);
});
