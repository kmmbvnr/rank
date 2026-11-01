import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { prepareStoredScalarView } from '../src/integer-view.js';

for (const compilation of [false, true]) describe(`singleton numeric slices (${compilation})`, () => {
    for (const kind of ['int32', 'int64', 'real'] as const) {
        it.each([false, true])(`owns its one ${kind} cell with a matrix selector = %s`, matrix => {
            const r = new Interpreter(undefined, { compilation }), d = new RuntimeDiagnostics();
            const cells = kind === 'int32' ? Int32Array.from({ length: 10000 }, (_, i) => i)
                : kind === 'int64' ? BigInt64Array.from({ length: 10000 }, (_, i) => 2n ** 40n + BigInt(i))
                    : Float64Array.from({ length: 10000 }, (_, i) => i + 0.25);
            const selected = matrix ? 1020 : 10;
            const expected = kind === 'real' ? selected + 0.25
                : kind === 'int64' ? 2n ** 40n + BigInt(selected) : BigInt(selected);
            const address = matrix ? '10 20' : '10';
            const read = matrix ? '0 0' : '0';
            try {
                r.variables.set('A', typedArray(cells, matrix ? [100, 100] : [10000]));
                r.execute(`use sequences\nS = A ${matrix ? '(10 till 11 array) (20 till 21 array)' : '(10 till 11 array)'}`);
                const slice = r.variables.get('S') as RankArray;
                expect(slice.shape).toEqual(matrix ? [1, 1] : [1]);
                const view = prepareStoredScalarView(slice, true)!;
                expect((view.compact ?? view.items as BigInt64Array).buffer).not.toBe(cells.buffer);
                expect(r.execute(`S ${read}`)).toBe(expected);
                d.run(() => r.execute(`A ${address} = ${kind === 'real' ? '99.5' : '99'}`));
                expect(r.execute(`S ${read}`)).toBe(expected);
                expect(d.cowCopiedCells).toBe(0);
                r.execute(`S ${read} = ${kind === 'real' ? '77.5' : '77'}`);
                expect(r.execute(`A ${address}`)).toBe(kind === 'real' ? 99.5 : 99n);
            } finally { r.dispose(); }
        });
    }

    it('keeps named singleton gathers stable across repeated source writes', () => {
        const r = new Interpreter(undefined, { compilation }), d = new RuntimeDiagnostics();
        try {
            expect(d.run(() => r.execute(`use sequences
A = array shape 10000 fill 0
Total = 0
for I in 9000 to 9010
 Ix = I to 9999 by I array
 Old = A Ix
 A Ix = I
 Total += Old sum
end
Total`))).toBe(0n);
            expect(d.cowCopiedCells).toBe(0);
            expect(r.execute('A (9000 to 9010) sum')).toBe(99055n);
        } finally { r.dispose(); }
    });
});
