import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, MISSING, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { borrowArrayStorage, derivedArray, integer32Cells, ownedArray, prepareScalarArrayWriter, readArrayItem, storedScalarKinds, typedArray, typedElementKind } from '../src/array-storage.js';
import { arrayElementTypes } from '../src/array-element-types.js';
import { registerScalarView } from '../src/integer-view.js';
import { mapStoredUnary } from '../src/unary-array-kernel.js';
import { scalarBuiltinArray } from '../src/scalar-builtin.js';
import { scalarNative } from '../src/modules/shared.js';
import { InterruptedError, withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';

const size = 2048;

describe('stored unary numeric kernels', () => {
    it.each(['compact', 'real'])('carries exact real/limit evidence from %s inputs', storage => {
        const input = storage === 'compact' ? typedArray(new Int32Array(size).fill(9))
            : typedArray(new Float64Array(size).fill(9), [size], undefined, 'real');
        for (const expected of [1.5, NaN, Infinity, -Infinity, -0]) {
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => {
                const out = mapStoredUnary(input, 'number', () => expected)!;
                expect(arrayElementTypes(out, true)).toEqual([expected === Infinity || expected === -Infinity ? 'numeric-limit' : 'real']);
                return out;
            });
            expect(diagnostics.elementTypeScannedCells).toBe(0);
            expect(readArrayItem(result, 0)).toBe(expected);
            expect(readArrayItem(result, size - 1)).toBe(expected);
        }
    });

    it('classifies stored numeric coercions without invoking them again', () => {
        const input = typedArray(new Int32Array(size));
        let conversions = 0;
        const result = mapStoredUnary(input, 'number', () => ({ valueOf() { conversions++; return Infinity; } }) as unknown as number)!;
        expect(conversions).toBe(size);
        expect(arrayElementTypes(result, true)).toEqual(['numeric-limit']);
        expect(conversions).toBe(size);
    });

    it('retains ordinary discovery for mixed real and numeric-limit outputs', () => {
        const input = typedArray(Int32Array.from({ length: size }, (_, i) => i));
        const result = mapStoredUnary(input, 'integer', n => n % 2 ? Infinity : NaN)!;
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => expect(arrayElementTypes(result, true)).toEqual(['numeric-limit', 'real']));
        expect(diagnostics.elementTypeScannedCells).toBe(size);
    });

    it('updates producer evidence through public and compiled writes', () => {
        const result = mapStoredUnary(typedArray(new Int32Array(size).fill(9)), 'number', Math.sqrt)!;
        const writer = prepareScalarArrayWriter(borrowArrayStorage(result));
        writer(0, Infinity);
        expect(storedScalarKinds(result, true)).toEqual(['numeric-limit', 'real']);
        writer(0, NaN);
        expect(storedScalarKinds(result, true)).toEqual(['real']);
        result.items[1] = -Infinity;
        expect(storedScalarKinds(result, true)).toEqual(['numeric-limit', 'real']);
        result.items[1] = 2.5;
        expect(storedScalarKinds(result, true)).toEqual(['real']);
        result.items.length = 0;
        expect(storedScalarKinds(result, true)).toEqual([]);
    });

    it('retains validation polling when producing under an observable budget', () => {
        const input = typedArray(new Int32Array(size).fill(9));
        const diagnostics = new RuntimeDiagnostics();
        withDemandBudget(100000, () => diagnostics.run(() => {
            const result = mapStoredUnary(input, 'number', Math.sqrt)!;
            expect(arrayElementTypes(result, true)).toEqual(['real']);
        }));
        expect(diagnostics.elementTypeScannedCells).toBe(size);
    });

    it.each(['sqrt', 'abs'])('maps real %s to typed storage with scalar parity', name => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers');
            const values = Float64Array.from({ length: size }, (_, i) => name === 'abs' ? (i - 1024) * 0.25 : i * 0.25);
            values[0] = -0;
            values[1] = NaN;
            values[2] = Infinity;
            runtime.variables.set('Input', typedArray(values, [32, 64]));
            const result = runtime.execute(`Result = Input ${name}\nResult`)!;
            expect(isRankArray(result)).toBe(true);
            if (!isRankArray(result)) return;
            expect(result.shape).toEqual([32, 64]);
            expect(typedElementKind(result)).toBe('real');
            for (let i = 0; i < size; i++) expect(readArrayItem(result, i)).toBe(name === 'sqrt' ? Math.sqrt(values[i]) : Math.abs(values[i]));
        } finally { runtime.dispose(); }
    });

    it('keeps integer sqrt real and integer abs exact', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers');
            runtime.variables.set('Input', typedArray(new BigInt64Array(size).fill(81n)));
            const result = runtime.execute('Result = Input sqrt\nResult') as RankArray;
            expect(typedElementKind(result)).toBe('real');
            expect(readArrayItem(result, size - 1)).toBe(9);
            runtime.variables.set('Wide', typedArray(new BigInt64Array(size).fill(-(1n << 63n))));
            expect(readArrayItem(runtime.execute('Wide abs') as RankArray, size - 1)).toBe(1n << 63n);
        } finally { runtime.dispose(); }
    });

    it.each(['floor', 'ceil'])('keeps %s integer across packed and arbitrary-width results', name => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers');
            const operation = name === 'floor' ? Math.floor : Math.ceil;
            const values = Float64Array.from({ length: size }, (_, i) => (i - 1024) * 0.25);
            runtime.variables.set('Input', typedArray(values, [32, 64]));
            const compact = runtime.execute(`Result = Input ${name}\nResult`) as RankArray;
            expect(typedElementKind(compact)).toBe('integer');
            expect(integer32Cells(compact)).toBeDefined();
            expect(compact.shape).toEqual([32, 64]);
            for (let i = 0; i < size; i++) expect(readArrayItem(compact, i)).toBe(BigInt(operation(values[i])));
            // Widen after a compact prefix, then exceed signed 64-bit storage.
            values[500] = 2 ** 31;
            values[1000] = -(2 ** 31) - 0.5;
            values[1500] = 2 ** 80;
            values[size - 1] = -1e100;
            runtime.variables.set('Wide', typedArray(values));
            const wide = runtime.execute(`Wide ${name}`) as RankArray;
            for (let i = 0; i < size; i++) expect(readArrayItem(wide, i)).toBe(BigInt(operation(values[i])));
            const integers = new BigInt64Array(size).fill((1n << 62n) + 1n);
            runtime.variables.set('Integers', typedArray(integers));
            expect(readArrayItem(runtime.execute(`Integers ${name}`) as RankArray, size - 1)).toBe(integers[0]);
        } finally { runtime.dispose(); }
    });

    it('keeps isqrt exact at square boundaries and falls back for wide integers', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers');
            const root = 94906265n;
            const values = BigInt64Array.from({ length: size }, (_, i) => root * root + BigInt(i % 3) - 1n);
            runtime.variables.set('Input', typedArray(values));
            const result = runtime.execute('Result = Input isqrt\nResult') as RankArray;
            expect(typedElementKind(result)).toBe('integer');
            expect(integer32Cells(result)).toBeDefined();
            for (let i = 0; i < size; i++) expect(readArrayItem(result, i)).toBe(i % 3 === 0 ? root - 1n : root);
            const wideRoot = (1n << 60n) + 7n;
            runtime.variables.set('Wide', ownedArray(Array.from({ length: size }, (_, i) => wideRoot ** 2n + BigInt(i % 3) - 1n)));
            const wide = runtime.execute('Wide isqrt') as RankArray;
            for (let i = 0; i < size; i++) expect(readArrayItem(wide, i)).toBe(i % 3 === 0 ? wideRoot - 1n : wideRoot);
        } finally { runtime.dispose(); }
    });

    it.each(['floor', 'ceil', 'isqrt'])('preserves deferred %s domain failures', name => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers');
            const bad = name === 'isqrt' ? new BigInt64Array(size).fill(4n) : new Float64Array(size).fill(4);
            if (bad instanceof BigInt64Array) bad[size - 1] = -1n;
            else bad[size - 1] = Infinity;
            runtime.variables.set('Bad', typedArray(bad));
            runtime.execute(`Result' = Bad ${name}`);
            expect(runtime.execute('Result 0')).toBe(name === 'isqrt' ? 2n : 4n);
            expect(() => runtime.execute(`Result ${size - 1}`)).toThrow(name === 'isqrt' ? 'nonnegative integer' : 'finite number');
        } finally { runtime.dispose(); }
    });

    it('preserves the compact prefix when an integer result widens', () => {
        const cells = new Int32Array(size).fill(2);
        cells[size - 2] = 50000;
        const input = typedArray(cells);
        const result = mapStoredUnary(input, 'integer', value => value * value, 'integer')!;
        expect(result).toBeDefined();
        for (let index = 0; index < size; index++) {
            expect(readArrayItem(result, index)).toBe(BigInt(cells[index]) ** 2n);
        }
        expect(readArrayItem(input, size - 2)).toBe(50000n);
    });

    it('refuses lazy host cells without reading or invoking getters', () => {
        const input: RankArray = { kind: 'array', shape: [size],
            get items(): never { throw Error('host items'); },
            itemAt(): never { throw Error('host read'); } };
        expect(mapStoredUnary(input, 'real', Math.sqrt)).toBeUndefined();
    });

    it.each([2, -2])('maps a stored view with stride %s in logical order', stride => {
        const values = Float64Array.from({ length: size * 2 }, (_, i) => i * 0.25);
        const source = typedArray(values);
        const offset = stride > 0 ? 1 : values.length - 1;
        const at = (index: number) => offset + index * stride;
        const view = registerScalarView(derivedArray([size], [source], i => values[at(i)], true),
            source, at, { linear: () => ({ offset, stride }) });
        const result = mapStoredUnary(view, 'real', Math.sqrt)!;
        expect(result).toBeDefined();
        for (let i = 0; i < size; i++) expect(readArrayItem(result, i)).toBe(Math.sqrt(values[at(i)]));
    });

    it('leaves missing and failed domains to ordinary demand', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers');
            const values = new Float64Array(size).fill(4);
            values[size - 1] = -1;
            runtime.variables.set('Input', typedArray(values));
            runtime.execute("Roots' = Input sqrt");
            expect(runtime.execute('Roots 0')).toBe(2);
            expect(() => runtime.execute(`Roots ${size - 1}`)).toThrow('sqrt expects a nonnegative value');
            runtime.variables.set('Missing', ownedArray([MISSING, ...new Array<number>(size - 1).fill(4)]));
            const missing = runtime.execute('Missing sqrt') as RankArray;
            expect(readArrayItem(missing, 0)).toBe(MISSING);
            expect(readArrayItem(missing, 1)).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('does not bypass a replaced builtin call', () => {
        const fn = scalarNative('sqrt', () => 2, source => mapStoredUnary(source, 'real', Math.sqrt));
        Object.defineProperty(fn, 'call', { value: () => 42 });
        expect(scalarBuiltinArray(typedArray(new Float64Array(size).fill(4)), fn, [0])).toBeUndefined();
    });

    it('propagates cancellation and refuses host polling', () => {
        const input = typedArray(new Float64Array(size).fill(4));
        const signal = new Int32Array(new SharedArrayBuffer(4));
        signal[0] = 1;
        expect(() => withInterrupt(signal, () => mapStoredUnary(input, 'real', Math.sqrt))).toThrow(InterruptedError);
        const host: InterruptSignal = { length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {} };
        withInterrupt(host, () => expect(mapStoredUnary(input, 'real', Math.sqrt)).toBeUndefined());
    });
});
