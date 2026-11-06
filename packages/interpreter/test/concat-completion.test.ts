import { describe, expect, it } from 'vitest';
import { MISSING, RankError, RuntimeDiagnostics, formatValue, type RankArray, type RankSequence } from '../src/index.js';
import { arrayForWrite, derivedArray, noteArrayBinding, ownedArray, readArrayItem, typedArray } from '../src/array-storage.js';
import { registerScalarView } from '../src/integer-view.js';
import { ownedStorage } from '../src/array-storage-state.js';
import { maskSelection } from '../src/array-mask-selection.js';
import { concatValues } from '../src/modules/sequences.js';
import { materializeSequence } from '../src/sequence.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

function complete(value: RankSequence) {
    const diagnostics = new RuntimeDiagnostics();
    const result = diagnostics.run(() => materializeSequence(value));
    return { result, diagnostics };
}
const selected = (source: RankArray, flags?: boolean[]) => maskSelection(source,
    ownedArray(flags ?? Array(source.shape.reduce((a, b) => a * b, 1)).fill(true)));
const join = (...sources: (RankArray | RankSequence)[]) => concatValues(sources) as RankSequence;
const values = (array: RankArray) => Array.from({ length: array.shape[0] }, (_, i) => readArrayItem(array, i));

describe('stored numeric sequence concat completion', () => {
    it.each([1, 31, 32, 33, 63, 64, 65, 4095, 4096, 4097])('gathers masks and small boxed leaves at length %i', size => {
        const source = typedArray(Int32Array.from({ length: size }, (_, i) => i - 17));
        const flags = Array.from({ length: size }, (_, i) => i % 3 === 0);
        const stream = join(ownedArray([]), selected(source, flags), ownedArray([-99n, 12n]));
        const { result, diagnostics } = complete(stream);
        expect(values(result)).toEqual([...Array.from({ length: size }, (_, i) => BigInt(i - 17)).filter((_, i) => flags[i]), -99n, 12n]);
        expect(ownedStorage.get(result)!.typed).toBeInstanceOf(Int32Array);
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it.each([-(1n << 63n), (1n << 63n) - 1n, 9007199254740993n])('widens exact integer %s without rounding', wide => {
        const stream = join(selected(typedArray(new Int32Array([1, -2]))), ownedArray([wide]));
        const { result, diagnostics } = complete(stream);
        expect(values(result)).toEqual([1n, -2n, wide]);
        expect(ownedStorage.get(result)!.typed).toBeInstanceOf(BigInt64Array);
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it.each([1n << 63n, -(1n << 63n) - 1n])('retains arbitrary precision for %s', wide => {
        const { result, diagnostics } = complete(join(selected(typedArray(new Int32Array([1]))), ownedArray([wide])));
        expect(values(result)).toEqual([1n, wide]);
        expect(diagnostics.nativeSequenceCopies).toBe(0);
    });

    it('preserves real signed zero and fractional values', () => {
        const source = typedArray(new Float64Array([-0, 1.5, -2.75]));
        const { result, diagnostics } = complete(join(selected(source), ownedArray([0.125])));
        expect(values(result)).toEqual([-0, 1.5, -2.75, 0.125]);
        expect(Object.is(readArrayItem(result, 0), -0)).toBe(true);
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it('flattens nested native concatenations in iterator order', () => {
        let stream = selected(typedArray(new Int32Array([0])));
        for (let i = 1; i < 1000; i++) stream = join(stream, typedArray(new Int32Array([i])));
        const { result, diagnostics } = complete(stream);
        expect(values(result)).toEqual(Array.from({ length: 1000 }, (_, i) => BigInt(i)));
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it('does not retain a result cache and keeps COW snapshots', () => {
        const source = typedArray(new Int32Array([1, 2, 3]));
        noteArrayBinding(source);
        const stream = join(selected(source, [true, false, true]), ownedArray([4n]));
        const first = complete(stream).result;
        const writable = arrayForWrite(source)!;
        writable.items[0] = 99n;
        first.items[0] = 88n;
        expect(values(complete(stream).result)).toEqual([1n, 3n, 4n]);
        expect(readArrayItem(writable, 0)).toBe(99n);
    });

    it('preserves unread host cells and their ordered failures', () => {
        const reads: number[] = [];
        const host: RankArray = { kind: 'array', shape: [2], items: [], itemAt: i => {
            reads.push(i); if (i === 1) throw new Error('host failure'); return 7n;
        } };
        const stream = join(host, selected(typedArray(new Int32Array([1, 2]))));
        expect(reads).toEqual([]);
        expect(() => complete(stream)).toThrow('host failure');
        expect(reads).toEqual([0, 1]);
    });

    it('honors replaced child and parent iterators', () => {
        const child = selected(typedArray(new Int32Array([1, 2])));
        const stream = join(child, typedArray(new Int32Array([3])));
        child.plan.iterate = function* () { yield 9n; };
        expect(values(complete(stream).result)).toEqual([9n, 3n]);
        stream.plan.iterate = function* () { yield 11n; };
        expect(values(complete(stream).result)).toEqual([11n]);
    });

    it('does not invoke a child iterator getter during native admission', () => {
        const child = selected(typedArray(new Int32Array([1, 2])));
        const stream = join(child, typedArray(new Int32Array([3])));
        let gets = 0;
        Object.defineProperty(child.plan, 'iterate', { get() {
            gets++;
            return function* () { yield 9n; };
        } });
        expect(values(complete(stream).result)).toEqual([9n, 3n]);
        expect(gets).toBe(1);
    });

    it('retains changed size evidence and opaque polling on the ordinary path', () => {
        const make = () => join(selected(typedArray(new Int32Array([1, 2]))), ownedArray([3n]));
        const stream = make();
        Object.assign(stream.plan, { size: { kind: 'exact', value: 3n } });
        expect(complete(stream).diagnostics.nativeSequenceCopies).toBe(0);
        const signal = { length: 1, load: () => 0, exchange: () => 0, store() {}, wait() {} };
        expect(withInterrupt(signal, () => complete(make())).diagnostics.nativeSequenceCopies).toBe(0);
        expect(complete(make()).diagnostics.nativeSequenceCopies).toBe(1);
    });

    it('gathers a matrix mask in flat row order', () => {
        const source = typedArray(new Int32Array([1, 2, 3, 4, 5, 6]), [2, 3]);
        const mask = ownedArray([true, false, false, true, false, true], [2, 3]);
        const { result, diagnostics } = complete(join(maskSelection(source, mask), ownedArray([7n])));
        expect(values(result)).toEqual([1n, 4n, 6n, 7n]);
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it.each([Infinity, -Infinity, NaN])('preserves the non-finite real value %s', value => {
        const source = typedArray(new Float64Array([value, 0.25]));
        const stream = join(selected(source), ownedArray([0.5]));
        expect(values(complete(stream).result)).toEqual([value, 0.25, 0.5]);
    });

    it('preserves scalar binding checks without validating empty selections', () => {
        const source = typedArray(new Float64Array([1.5, 2.5]));
        let checks = 0;
        const check = () => { checks++; throw new RankError('expected integer'); };
        const wrong = registerScalarView(derivedArray([2], [source], check), source, i => i,
            { linear: () => ({ offset: 0, stride: 1 }), check, scalarCheck: true });
        const empty = maskSelection(wrong, ownedArray([false, false]));
        expect(values(complete(join(empty, ownedArray([2n]))).result)).toEqual([2n]);
        expect(checks).toBe(0);
        expect(() => complete(join(maskSelection(wrong, ownedArray([true, false])), ownedArray([2.0]))))
            .toThrow(/integer/);
        expect(checks).toBe(1);
    });

    it('retains missing source cells on the ordinary path', () => {
        const source = ownedArray([1n, MISSING, 3n]);
        const { result, diagnostics } = complete(join(selected(source), ownedArray([4n])));
        expect(formatValue(result)).toBe('1 .NA 3 4');
        expect(diagnostics.nativeSequenceCopies).toBe(0);
    });

    it('copies reversed scalar views and mask positions with their strides', () => {
        const source = typedArray(new Int32Array([10, 20, 30, 40, 50]));
        const view = registerScalarView(derivedArray([3], [source], i => readArrayItem(source, 4 - 2 * i)),
            source, i => 4 - 2 * i, { linear: () => ({ offset: 4, stride: -2 }) });
        const { result, diagnostics } = complete(join(view, selected(view, [true, false, true])));
        expect(values(result)).toEqual([50n, 30n, 10n, 50n, 10n]);
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it('retains ordinary behavior for an inconsistent native storage shape', () => {
        const observe = (fallback: boolean) => {
            const source = typedArray(new Int32Array([1]), [2]);
            const stream = join(selected(source), ownedArray([2n]));
            if (fallback) Object.assign(stream.plan, { size: { ...stream.plan.size } });
            try {
                const { result, diagnostics } = complete(stream);
                return { value: formatValue(result), copies: diagnostics.nativeSequenceCopies };
            } catch (error) { return { error: String(error) }; }
        };
        expect(observe(false)).toEqual(observe(true));
    });

    it('retains mixed-domain errors and ignores empty input domains', () => {
        const make = () => join(selected(typedArray(new Int32Array([1, 2]))), ownedArray([true]));
        expect(() => complete(make())).toThrow(/one element type/);
        const empty = selected(typedArray(new Float64Array(0)), []);
        expect(formatValue(complete(join(empty, ownedArray([1n]))).result)).toBe('1');
    });

    it('cancels private completion and can retry the same inputs', () => {
        const source = typedArray(Int32Array.from({ length: 10000 }, (_, i) => i));
        const stream = join(selected(source), ownedArray([1n]));
        expect(() => withDemandBudget(0, () => complete(stream))).toThrow(DemandBudgetExhausted);
        expect(readArrayItem(complete(stream).result, 9999)).toBe(9999n);
        expect(readArrayItem(source, 9999)).toBe(9999n);
    });
});
