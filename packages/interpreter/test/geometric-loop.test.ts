import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';
import { integerSquareRoot, safeIntegerSquareRoot } from '../src/integer-square-root.js';

function observe(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    let result: unknown;
    try {
        try { diagnostics.run(() => { const value = runtime.execute(source); result = [typeof value, value === undefined ? undefined : formatValue(value), Object.is(value, -0)]; }); }
        catch (failure) { error = String(failure); }
        return { diagnostics, result: { error, result, values: [...runtime.variables].map(([name, value]) => [name, typeof value, formatValue(value), Object.is(value, -0), isRankArray(value) ? value.items.map(item => typeof item) : undefined]) } };
    } finally { runtime.dispose(); }
}

describe('geometric numeric loop builtins', () => {
    it('uses private numeric registers for exact square roots and array stores', () => {
        const source = 'use numbers\nA = array shape 64 fill 0\nfor I in 0 till 64\n A I = (I * I + I) isqrt\nend';
        const candidate = observe(source);
        expect(candidate.result).toEqual(observe(source, false).result);
        expect(candidate.diagnostics.numberLoops).toBe(1);
    });

    it.each([
        'S = 0.0\nfor I in 0 to 3\n S += I / 3\nend',
        'for I in 0 to 3\n S = -0.0\nend',
        'A = array 1.0 2.0 3.0\nB = A\nDone = array false false false\nfor I in 0 to 2\n A I += I / 2\n Done I = true\nend',
        'A = array 1.0 2.0 3.0\nB = A\nDone = array false false false\nWide = 9007199254740990\nfor I in 0 to 2\n A I += 0.5\n Done I = true\n Wide += 1\nend',
        'A = array 1.0 2.0 3.0\nB = A\nfor I in 0 to 3\n A I += 0.5\nend',
        'A = array 1.0 2.0 3.0\nfor I in 0 to 2\n A I = 1.0 / (I - 1)\nend',
        'use numbers\nA = array 1.0 2.0 3.0\nfor I in 0 to 2\n A I += 0.5\n R = I acos\nend',
        'for I in 0 to 3\n if I equal 3\n  S = 0.5\n else\n  N = 1\n end\nend',
    ])('publishes mixed loop types, aliases, results and partial writes: %s', source => {
        const candidate = observe(source);
        expect(candidate.result).toEqual(observe(source, false).result);
        expect(candidate.diagnostics.numberLoops).toBeGreaterThan(0);
    });

    it('publishes mixed stores and preserves aliases on cancellation', () => {
        const runtime = new Interpreter(() => {});
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => runtime.execute(`A = array 0.0 0.0
B = A
Mask = array false false
Original = Mask
Last = -1
for I in 0 to 1000000
 A (I mod 2) += 0.5
 Mask (I mod 2) = true
 Last = I
end`))).toThrow('Interrupted');
            runtime.execute('Total = A sum\nBefore = B sum');
            const last = Number(runtime.variables.get('Last'));
            expect(runtime.variables.get('Total')).toBe((last + 1) * 0.5);
            expect(runtime.variables.get('Before')).toBe(0);
            const original = runtime.variables.get('Original');
            if (original === undefined || !isRankArray(original)) throw new Error('expected mask');
            expect(original.items).toEqual([false, false]);
        } finally { runtime.dispose(); }
    });

    it.each(['isqrt', 'acos'])('rechecks cached %s identity on every entry', name => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        try {
            runtime.execute(`use numbers\nfun work\n S = 0.0\n for I in 0 to 1\n  S += I ${name}\n end\n return S\nend`);
            runtime.execute('Before = work');
            runtime.execute('fun X replacement\n return 3\nend');
            runtime.variables.set(name, runtime.variables.get('replacement')!);
            runtime.execute('After = work');
            expect(runtime.variables.get('After')).toBe(6);
        } finally { runtime.dispose(); }
    });

    it('corrects square-root seeds on both sides of large perfect squares', () => {
        for (const root of [0, 1, 2, 32767, 67108863, 94906265]) {
            for (const offset of [-1, 0, 1]) {
                const value = root * root + offset;
                if (value >= 0 && Number.isSafeInteger(value)) {
                    expect(BigInt(safeIntegerSquareRoot(value))).toBe(integerSquareRoot(BigInt(value)));
                }
            }
        }
    });

    it.each([
        'use numbers\nfor I in 0 to 3\n Before = I\n R = (2 - I) isqrt\nend',
        'use numbers\nfor I in 0 to 3\n Before = I\n R = (I - 1) acos\nend',
        'use numbers\nfor I in 0 to 3\n R = (I / 3) acos\nend',
        'use numbers\nA = 10000000000000000000000000000000000000000\nfor I in 0 to 2\n R = (A + I) isqrt\nend',
        'use numbers\nfun X isqrt\n return X + 2\nend\nfor I in 0 to 3\n R = I isqrt\nend',
        'use numbers\nfun X acos\n return X + 2\nend\nfor I in 0 to 3\n R = I acos\nend',
    ])('preserves values, domain errors, progress and shadowing: %s', source => {
        expect(observe(source).result).toEqual(observe(source, false).result);
    });
});
