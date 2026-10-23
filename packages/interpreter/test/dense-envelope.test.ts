import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { borrowArrayStorage, ownedArray, prepareMatrixArrayReader, prepareScalarArrayWriter } from '../src/array-storage.js';
import { atArray } from '../src/selectors.js';
import { type RankArray } from '../src/value.js';

describe('dense real envelope DP', () => {
    const source = readFileSync(new URL('../../../demos/euler/314_mousemoon.ra', import.meta.url), 'utf8')
        .replace('option Grid integer = 250', 'option Grid integer = 10');

    it.each([true, false])('includes the initial vertical perimeter with compilation %s', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const diagnostics = new RuntimeDiagnostics();
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBeCloseTo(5.283358681334832, 12);
            if (compilation) {
                expect(diagnostics.fallbacks['loop:unsupported-op:cross']).toBeUndefined();
                // The envelope and query loops compile as regions, not thousands
                // of separately entered scalar fragments.
                expect(diagnostics.compiledLoops).toBeLessThan(200);
            }
        } finally { runtime.dispose(); }
    });

    it('keeps real compound matrix stores private from an earlier alias', () => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(`M = array shape 3 4 fill 0.5
Alias = M
for I in 0 till 3
  for J in 0 till 4
    M I J += I + J / 2.0
  end
end`);
                expect(runtime.execute('M 2 3')).toBe(4);
                expect(runtime.execute('Alias 2 3')).toBe(0.5);
            } finally { runtime.dispose(); }
        }
    });

    it('links real scalar arguments and results inside one compiled loop', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => calls++ });
        try {
            const diagnostics = new RuntimeDiagnostics();
            diagnostics.run(() => runtime.execute(`fun X divide Scale
  return X / Scale
end
Total = 0.0
for I in 1 to 10
  Total += I divide 2.0
end`));
            expect(runtime.variables.get('Total')).toBe(27.5);
            expect(calls).toBe(10);
            expect(diagnostics.compiledLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('preserves partial real writes and bounds errors', () => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('M = array shape 2 2 fill 0.5');
                expect(() => runtime.execute('for I in 0 to 2\n M 1 I += 1.25\nend')).toThrow('array index out of bounds on axis 1');
                expect(runtime.execute('M 1 0')).toBe(1.75);
                expect(runtime.execute('M 1 1')).toBe(1.75);
            } finally { runtime.dispose(); }
        }
    });
});

describe('prepared matrix readers', () => {
    it('checks both axes in order, including huge and negative indices', () => {
        const array = borrowArrayStorage(ownedArray([1.5, 2.5, 3.5, 4.5], [2, 2], true)) as RankArray;
        const read = prepareMatrixArrayReader(array, atArray);
        expect(read(1n, 0n)).toBe(3.5);
        expect(() => read(-1n, 3n)).toThrow('array index out of bounds on axis 0');
        expect(() => read(0n, 10n ** 100n)).toThrow('array index out of bounds on axis 1');
        expect(() => read(0n, -1n)).toThrow('array index out of bounds on axis 1');
    });

    it('follows a borrowed buffer replaced by a write', () => {
        const array = borrowArrayStorage(ownedArray([1n, 2n, 3n, 4n], [2, 2], true)) as RankArray;
        const read = prepareMatrixArrayReader(array, atArray), write = prepareScalarArrayWriter(array, true);
        expect(read(1n, 1n)).toBe(4n);
        write(3, 10n ** 100n);
        expect(read(1n, 1n)).toBe(10n ** 100n);
    });

    it('does not inspect host cells when preparing fallback readers', () => {
        let reads = 0, shapes = 0;
        const array: RankArray = { kind: 'array', get shape() { shapes++; return [1, 1]; }, get items() { reads++; return [7]; } };
        const read = prepareMatrixArrayReader(array, atArray, true);
        expect(reads).toBe(0);
        expect(shapes).toBe(0);
        expect(read(0n, 0n)).toBe(7);
        expect(reads).toBeGreaterThan(0);
    });
});
