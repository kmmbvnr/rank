import { describe, expect, it } from 'vitest';
import { Interpreter, MISSING, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { arrayElementTypes } from '../src/array-element-types.js';
import { arrayDeclaration } from '../src/array-declaration.js';
import { copyArrayStorage } from '../src/array-copy.js';
import { arrayRevision, borrowArrayStorage, ownedArray, prepareScalarArrayWriter, realCells, storedScalarKinds, typedArray } from '../src/array-storage.js';
import { prepareIntegerView } from '../src/integer-view.js';
import { semanticArrayType } from '../src/semantic-array-type.js';

describe('physical scalar kind evidence', () => {
    it('reads Float64 physical kinds without scanning and preserves exact infinity contracts', () => {
        const array = typedArray(new Float64Array([1.5, Infinity, NaN]));
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            expect(storedScalarKinds(array)).toEqual(['real']);
            expect(arrayElementTypes(array)).toEqual(['real']);
            expect(storedScalarKinds(typedArray(new Float64Array(0)))).toEqual([]);
        });
        expect(diagnostics.elementTypeScannedCells).toBe(0);
        expect(arrayElementTypes(array, true)).toEqual(['numeric-limit', 'real']);
        const borrowed = borrowArrayStorage(array);
        const write = prepareScalarArrayWriter(borrowed);
        write(1, 2.5);
        expect(arrayElementTypes(array, true)).toEqual(['real']);
        write(0, -Infinity);
        expect(arrayElementTypes(array, true)).toEqual(['numeric-limit', 'real']);
    });

    it('carries an infinity-only contract through a real block copy', () => {
        const source = typedArray(new Float64Array(5000).fill(Infinity));
        const copied = copyArrayStorage(source)!;
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => expect(arrayElementTypes(copied, true)).toEqual(['numeric-limit']));
        expect(diagnostics.elementTypeScannedCells).toBe(0);
        const runtime = new Interpreter();
        try {
            runtime.variables.set('A', copied);
            runtime.execute('A 0 = 1');
            expect(runtime.execute('A 0')).toBe(1n);
            expect(() => runtime.execute('A 0 = 1.0')).toThrow(/array elements/);
        } finally { runtime.dispose(); }
    });

    it.each(['set', 'defineProperty'])('invalidates after a partially failed length %s', operation => {
        const array = ownedArray([1n, 2n, 3n, 4n]);
        array.items[2] = true;
        array.items[3] = 'tail';
        expect(arrayElementTypes(array)).toEqual(['boolean', 'integer', 'text']);
        Object.defineProperty(array.items, '1', { configurable: false });
        const revision = arrayRevision(array)!;
        const success = operation === 'set' ? Reflect.set(array.items, 'length', 0)
            : Reflect.defineProperty(array.items, 'length', { value: 0 });
        expect(success).toBe(false);
        expect(array.items.length).toBe(2);
        expect(arrayRevision(array)).toBeGreaterThan(revision);
        expect(arrayElementTypes(array)).toEqual(['integer']);
    });

    it('reuses validation across same-kind public writes and shares the proof between consumers', () => {
        const array = ownedArray([1n, 2n, 3n]);
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            for (let i = 0; i < 20; i++) {
                expect(arrayElementTypes(array)).toEqual(['integer']);
                expect(prepareIntegerView(array)!.read(0)).toBe(BigInt(i + 1));
                expect(realCells(array)).toBeUndefined();
                array.items[0] = BigInt(i + 2);
            }
        });
        expect(diagnostics.elementTypeScans).toBe(0);
        expect(diagnostics.elementTypeScannedCells).toBe(0);
        expect(arrayDeclaration(array)).toBeUndefined();
    });

    it('updates exact kind counts through public writes and data descriptors', () => {
        const array = ownedArray([1n, 2n]);
        expect(semanticArrayType(array).scalar).toBe('integer');
        array.items[0] = 1.5;
        expect(arrayElementTypes(array)).toEqual(['integer', 'real']);
        expect(prepareIntegerView(array)).toBeUndefined();
        Object.defineProperty(array.items, '1', { value: Infinity });
        expect(arrayElementTypes(array, true)).toEqual(['numeric-limit', 'real']);
        expect(arrayElementTypes(array)).toEqual(['real']);
        expect(semanticArrayType(array).scalar).toBe('real');
        expect(realCells(array)).toEqual([1.5, Infinity]);
        array.items[0] = -Infinity;
        array.items[1] = NaN;
        expect(arrayElementTypes(array, true)).toEqual(['numeric-limit', 'real']);
        array.items[0] = true;
        array.items[1] = 'x';
        expect(storedScalarKinds(array)).toEqual(['boolean', 'text']);
    });

    it.each([false, true])('maintains the proof through a compiled writer (batch %s)', batch => {
        const array = ownedArray([1n, 2n]);
        expect(storedScalarKinds(array)).toEqual(['integer']);
        const borrowed = borrowArrayStorage(array);
        const write = prepareScalarArrayWriter(borrowed, batch);
        write(0, 5n);
        write(1, true);
        expect(storedScalarKinds(array)).toEqual(['boolean', 'integer']);
        write(0, false);
        expect(storedScalarKinds(array)).toEqual(['boolean']);
    });

    it('preserves the proof when typed storage converts and declines missing or replaced storage', () => {
        const array = typedArray(new BigInt64Array([1n, 2n]));
        expect(storedScalarKinds(array)).toEqual(['integer']);
        array.items[0] = 1n << 100n;
        expect(prepareIntegerView(array)!.read(0)).toBe(1n << 100n);
        array.items[0] = MISSING;
        expect(storedScalarKinds(array)).toBeUndefined();
        expect(arrayElementTypes(array)).toEqual(['integer', 'missing']);
        const replaced = ownedArray([1n]);
        expect(storedScalarKinds(replaced)).toEqual(['integer']);
        (replaced as { items: unknown }).items = [true];
        expect(storedScalarKinds(replaced)).toBeUndefined();
        expect(arrayElementTypes(replaced)).toBeUndefined();
    });

    it('invalidates on length changes and never reads an accessor to prove kinds', () => {
        const array = ownedArray([1n, 2n]);
        expect(storedScalarKinds(array)).toEqual(['integer']);
        array.items.length = 0;
        expect(storedScalarKinds(array)).toEqual([]);
        array.items.push(1n);
        expect(storedScalarKinds(array)).toEqual(['integer']);
        let reads = 0;
        Object.defineProperty(array.items, '0', { get() { reads++; return true; } });
        expect(storedScalarKinds(array)).toBeUndefined();
        expect(arrayElementTypes(array)).toBeUndefined();
        expect(reads).toBe(0);
        const lazy: RankArray = { kind: 'array', shape: [1], items: [], itemAt() { reads++; return 1n; } };
        expect(storedScalarKinds(lazy)).toBeUndefined();
        expect(arrayElementTypes(lazy)).toBeUndefined();
        expect(reads).toBe(0);
    });
});

describe.each([false, true])('slice read/write type scans with compilation %s', compiled => {
    it('does not rescan the whole source after each scalar write', () => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const result = diagnostics.run(() => runtime.execute(`use sequences
Limit = 2000
A = 0 to Limit array
for P in primes to Limit
 Hits = P to Limit by P
 Seen = A Hits sum
 A P += 1
end
A sum`));
            expect(result).toBe(2001303n);
            expect(diagnostics.cowCopiedCells).toBe(0);
            expect(diagnostics.elementTypeScannedCells).toBeLessThan(10000);
        } finally { runtime.dispose(); }
    });
});
