import { completed } from '../src/execution.js';
import { Interpreter } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { arrayValues, derivedArray, ownedArray, readArrayItem } from '../src/array-storage.js';
import { Operators } from '../src/operators.js';
import { native } from '../src/modules/shared.js';
import { isRankArray, type RankSequence } from '../src/value.js';

const operators = () => new Operators(() => {}, () => undefined);

describe.each([3, 65_537])('outer sequence demand (size=%s)', size => {
    it('restarts each indexed observation instead of retaining a prefix or iterator', () => {
        let starts = 0;
        let closes = 0;
        const reads: number[] = [];
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'counted', size: { kind: 'exact', value: BigInt(size) },
            *iterate() {
                starts++;
                try {
                    for (let i = 0; i < size; i++) { reads.push(i); yield BigInt(i); }
                } finally { closes++; }
            },
        } };
        const result = operators().evaluateOuter('+', input, ownedArray([10n]));
        if (!isRankArray(result)) throw Error('expected array');
        // Shape inference may observe one cell; it must close that traversal.
        expect(result.shape).toEqual([size, 1]);
        expect(reads).toEqual([0]);
        expect(starts).toBe(closes);
        reads.length = 0;
        expect(readArrayItem(result, 2)).toBe(12n);
        expect(readArrayItem(result, 2)).toBe(12n);
        expect(reads).toEqual([0, 1, 2, 0, 1, 2]);
        expect(starts).toBe(closes);
    });

    it('stacks array cells and snapshots them before iterator cleanup mutates the buffer', () => {
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'borrowed rows', size: { kind: 'exact', value: BigInt(size) },
            *iterate() {
                const items = [0n, 0n];
                const row = { kind: 'array' as const, shape: [2], items };
                try {
                    for (let i = 0; i < size; i++) {
                        items[0] = BigInt(i); items[1] = BigInt(i + 1);
                        yield row;
                    }
                } finally { items.fill(-100n); }
            },
        } };
        const result = operators().evaluateOuter('+', input, ownedArray([10n]));
        if (!isRankArray(result)) throw Error('expected array');
        expect(result.shape).toEqual([size, 2, 1]);
        expect(readArrayItem(result, 4)).toBe(12n);
        expect(readArrayItem(result, 5)).toBe(13n);
        expect(readArrayItem(result, 4)).toBe(12n);
    });

    it('infers cell shape without reading unselected lazy row scalars', () => {
        const offsets: number[] = [];
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'lazy rows', size: { kind: 'exact', value: BigInt(size) },
            *iterate() {
                let current = 0;
                const row = derivedArray([2], [], offset => { offsets.push(offset); return BigInt(current + offset); });
                try { for (current = 0; current < size; current++) yield row; }
                finally { current = -100; }
            },
        } };
        const result = operators().evaluateOuter('+', input, ownedArray([10n]));
        if (!isRankArray(result)) throw Error('expected array');
        expect(result.shape).toEqual([size, 2, 1]);
        expect(offsets).toEqual([]);
        expect(readArrayItem(result, 5)).toBe(13n);
        expect(readArrayItem(result, 4)).toBe(12n);
        expect(offsets).toEqual([1, 0]);
    });

    it('keeps a later input error deferred and retries a fresh observation', () => {
        let starts = 0;
        let closes = 0;
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'late failure', size: { kind: 'exact', value: BigInt(size) },
            *iterate() {
                starts++;
                try { yield 1n; yield 2n; throw Error('third value'); }
                finally { closes++; }
            },
        } };
        const result = operators().evaluateOuter('+', input, ownedArray([10n]));
        if (!isRankArray(result)) throw Error('expected array');
        expect(readArrayItem(result, 0)).toBe(11n);
        expect(() => readArrayItem(result, 2)).toThrow('third value');
        expect(readArrayItem(result, 1)).toBe(12n);
        expect(starts).toBe(closes);
    });

    it('owns one bounded cursor per partial traversal and closes it on early stop', () => {
        let starts = 0;
        let closes = 0;
        const reads: number[] = [];
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'streamed', size: { kind: 'exact', value: BigInt(size) },
            *iterate() {
                starts++;
                try { for (let i = 0; i < size; i++) { reads.push(i); yield BigInt(i); } }
                finally { closes++; }
            },
        } };
        const result = operators().evaluateOuter('+', input, ownedArray([10n, 20n]));
        if (!isRankArray(result)) throw Error('expected array');
        reads.length = 0;
        for (let pass = 0; pass < 2; pass++) {
            const values = arrayValues(result);
            expect(Array.from({ length: 5 }, () => values.next().value)).toEqual([10n, 20n, 11n, 21n, 12n]);
            values.return?.();
            expect(starts).toBe(closes);
        }
        expect(reads).toEqual([0, 1, 2, 0, 1, 2]);
    });

    it('streams named scalar operations without retaining source history', () => {
        const reads: number[] = [];
        let closes = 0;
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'named stream', size: { kind: 'exact', value: BigInt(size) },
            *iterate() {
                try { for (let i = 0; i < size; i++) { reads.push(i); yield BigInt(i); } }
                finally { closes++; }
            },
        } };
        const fn = { ...native('first', 2, args => args[0]), dyadicRanks: [0, 0] as const };
        const result = operators().evaluateNamedOuter(fn, input, ownedArray([10n, 20n]));
        if (!isRankArray(result)) throw Error('expected array');
        reads.length = 0;
        const closedBefore = closes;
        for (let pass = 0; pass < 2; pass++) {
            const values = arrayValues(result);
            expect(Array.from({ length: 5 }, () => values.next().value)).toEqual([0n, 0n, 1n, 1n, 2n]);
            values.return?.();
        }
        expect(reads).toEqual([0, 1, 2, 0, 1, 2]);
        expect(closes - closedBefore).toBe(2);
    });

    it('uses the same cell axes for named outer functions', () => {
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'rows', size: { kind: 'exact', value: BigInt(size) },
            *iterate() { for (let i = 0; i < size; i++) yield ownedArray([BigInt(i), 1n]); },
        } };
        const fn = { ...native('row first', 2, args => {
            const row = args[0];
            if (!isRankArray(row)) throw Error('expected row');
            return readArrayItem(row, 0);
        }), dyadicRanks: [1, 0] as const };
        const result = operators().evaluateNamedOuter(fn, input, ownedArray([10n]));
        if (!isRankArray(result)) throw Error('expected array');
        expect(result.shape).toEqual([size, 1]);
        expect(readArrayItem(result, 2)).toBe(2n);
    });
});

it('does not restart a consumable exact resource to implement random access', () => {
    let opens = 0;
    const input: RankSequence = { kind: 'sequence', plan: {
        name: 'resource', size: { kind: 'exact', value: 3n }, singlePass: true,
        *iterate() { if (++opens > 1) throw Error('resource restarted'); yield 1n; yield 2n; yield 3n; },
    } };
    const result = operators().evaluateOuter('+', input, ownedArray([10n]));
    if (!isRankArray(result)) throw Error('expected array');
    expect(readArrayItem(result, 2)).toBe(13n);
    expect(readArrayItem(result, 0)).toBe(11n);
    expect(opens).toBe(1);
});


it.each(['left', 'right'])('observes %s empty producers without reading the unused scalar input', side => {
    let reads = 0;
    const input: RankSequence = { kind: 'sequence', plan: {
        name: 'empty cells', size: { kind: 'exact', value: 3n },
        *iterate() { for (let i = 0; i < 3; i++) { reads++; yield ownedArray([], [0]); } },
    } };
    let scalarReads = 0;
    const scalar: RankSequence = { kind: 'sequence', plan: {
        name: 'unused scalar', size: { kind: 'exact', value: 1n },
        *iterate() { scalarReads++; yield 10n; },
    } };
    const result = operators().evaluateOuter('+', ...(side === 'left' ? [input, scalar] : [scalar, input]) as [RankSequence, RankSequence]);
    if (!isRankArray(result)) throw Error('expected array');
    expect(result.shape).toEqual(side === 'left' ? [3, 0, 1] : [1, 3, 0]);
    scalarReads = 0;
    reads = 0;
    expect(result.items).toEqual([]);
    expect(result.items).toEqual([]);
    expect(reads).toBe(6);
    expect(scalarReads).toBe(0);
});


describe.each([false, true])('outer plan binding (compilation=%s)', compilation => {
    it('recomputes planned products and retains completed tensor cells', () => {
        let reads = 0;
        const input: RankSequence = { kind: 'sequence', plan: {
            name: 'rows', size: { kind: 'exact', value: 3n },
            *iterate() { for (let i = 0; i < 3; i++) { reads++; yield ownedArray([BigInt(i), 1n]); } },
        } };
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Input', input);
            runtime.execute("Product' = Input (array 10) outer +");
            expect(reads).toBe(0);
            runtime.execute('Saved = Product');
            const firstPass = reads;
            expect(firstPass).toBeGreaterThan(0);
            runtime.execute('Again = Product');
            expect(reads).toBe(firstPass * 2);
            const saved = runtime.variables.get('Saved')!;
            if (!isRankArray(saved)) throw Error('expected array');
            expect(saved.shape).toEqual([3, 2, 1]);
            expect(saved.items).toEqual([10n, 11n, 11n, 11n, 12n, 11n]);
            expect(reads).toBe(firstPass * 2);
        } finally { runtime.dispose(); }
    });
});


it('demands a named callback scalar plan afresh at each result observation', () => {
    let calls = 0;
    const fn = { ...native('planned scalar', 2, () => ({
        kind: 'plan', dependencies: new Map(),
        evaluate: () => completed(BigInt(++calls)),
    })), dyadicRanks: [0, 0] as const };
    const result = operators().evaluateNamedOuter(fn, ownedArray([1n]), ownedArray([2n]));
    if (!isRankArray(result)) throw Error('expected array');
    expect(calls).toBe(0);
    expect(readArrayItem(result, 0)).toBe(1n);
    expect(readArrayItem(result, 0)).toBe(2n);
});
