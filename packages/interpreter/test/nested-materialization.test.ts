import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, tuple, typeName, type RankArray, type RankCounter, type RankIndex, type RankQueue,
    type RankRecord, type RankSet, type RankValue } from '../src/index.js';
import { completed } from '../src/execution.js';
import { materializeValue } from '../src/materialize.js';
import { RankDeque, RankHeap } from '../src/containers.js';
import { newStructure } from '../src/collections.js';
import { sequence } from '../src/sequence.js';
import { isRankPlan, type RankPlan } from '../src/plan.js';
import { denseScalarItems, ownedArray, readArrayItem } from '../src/array-storage.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { isStoredValue } from '../src/stored-value.js';
import { MissingValueError } from '../src/errors.js';
import { MISSING } from '../src/value.js';

function plan(compute: () => RankValue): RankPlan {
    return { kind: 'plan', dependencies: new Map(), evaluate: () => completed(compute()) };
}

function record(entries: [string, RankValue][]): RankRecord {
    return { kind: 'record', entries: new Map(entries), types: new Map(entries.map(([key, value]) => [key, typeName(value)])) };
}

describe('recursive value completion', () => {
    it('invalidates a fresh parent after changing an older scalar index', () => {
        const index = newStructure('index') as RankIndex;
        index.entries.set('value', 1n);
        (newStructure('index') as RankIndex).entries.set('unrelated', plan(() => 0n));
        const parent = new RankDeque().push(index);
        expect(isStoredValue(parent)).toBe(true);
        index.entries.set('value', plan(() => 3n));
        expect(isStoredValue(parent)).toBe(false);
        const result = materializeValue(parent) as RankDeque;
        expect((result.peek() as RankIndex).entries.get('value')).toBe(3n);
    });

    it('keeps soft missing plan cells and propagates hard failures', () => {
        const source: RankArray = { kind: 'array', shape: [1], items: [plan(() => {
            throw new MissingValueError('soft missing', true);
        })] };
        expect(readArrayItem(materializeValue(source) as RankArray, 0)).toBe(MISSING);
        source.items[0] = plan(() => { throw new MissingValueError('hard missing'); });
        expect(() => materializeValue(source)).toThrowError('hard missing');
    });

    it('invalidates ancestor storage proofs after a deferred array write through an alias', () => {
        let calls = 0;
        const array = ownedArray([1n]);
        // Older scalar storage remains independently known after unrelated
        // deferred insertions; a new parent may rely on that proof.
        (newStructure('index') as RankIndex).entries.set('unrelated', plan(() => 0n));
        const index = newStructure('index') as RankIndex;
        index.entries.set('array', array);
        const queue = new RankDeque().push(index);
        expect(isStoredValue(queue)).toBe(true);
        expect(materializeValue(queue)).toBe(queue);
        const deferred = plan(() => { calls++; return 7n; });
        array.items[0] = deferred;
        expect(isStoredValue(queue)).toBe(false);
        const result = materializeValue(queue) as RankDeque;
        const stored = (result.peek() as RankIndex).entries.get('array') as RankArray;
        expect(formatValue(stored)).toBe('7');
        expect(calls).toBe(1);
        expect(array.items[0]).toBe(deferred);
    });

    it('does not certify untracked mutable host containers', () => {
        const source: RankIndex = { kind: 'index', entries: new Map([['value', 1n]]) };
        const parent = new RankDeque().push(source);
        expect(isStoredValue(parent)).toBe(false);
        expect(materializeValue(parent)).toBe(parent);
        source.entries.set('value', plan(() => 2n));
        const result = materializeValue(parent) as RankDeque;
        expect((result.peek() as RankIndex).entries.get('value')).toBe(2n);
        expect(isRankPlan(source.entries.get('value')!)).toBe(true);
    });

    it('completes tuple, record and array children without changing their sources', () => {
        let calls = 0;
        const deferred = plan(() => { calls++; return 7n; });
        const sourceRecord = record([['value', deferred]]);
        const sourceArray: RankArray = { kind: 'array', shape: [1, 2], items: [deferred, deferred] };
        const source = tuple([sourceRecord, sourceArray]);
        const result = materializeValue(source) as typeof source;
        expect(formatValue(result.items[1])).toBe('7 7');
        expect((result.items[0] as RankRecord).entries.get('value')).toBe(7n);
        expect((result.items[0] as RankRecord).types.get('value')).toBe('integer');
        expect((result.items[1] as RankArray).shape).toEqual([1, 2]);
        expect(denseScalarItems(result.items[1] as RankArray)).toBeDefined();
        expect(calls).toBe(3);
        expect(sourceRecord.entries.get('value')).toBe(deferred);
        expect(sourceArray.items).toEqual([deferred, deferred]);
        materializeValue(source);
        expect(calls).toBe(6);
    });

    it('preserves shared aggregate identity within one binding', () => {
        let calls = 0;
        const shared = record([['value', plan(() => { calls++; return 3n; })]]);
        const result = materializeValue(tuple([shared, shared])) as ReturnType<typeof tuple>;
        expect(result.items[0]).toBe(result.items[1]);
        expect(result.items[0]).not.toBe(shared);
        expect(calls).toBe(1);
    });

    it('retains ready values and mutable cycles', () => {
        const ready = record([['values', ownedArray([1n, 2n])]]);
        const source = newStructure('index') as RankIndex;
        source.entries.set('self', source);
        source.entries.set('ready', ready);
        expect(materializeValue(source)).toBe(source);
        expect(materializeValue(tuple([ready]))).toMatchObject({ items: [ready] });
    });

    it('rewires a changed index cycle without changing the original graph', () => {
        const source = newStructure('index') as RankIndex;
        const deferred = plan(() => 5n);
        source.entries.set('self', source);
        source.entries.set('value', deferred);
        const result = materializeValue(source) as RankIndex;
        expect(result).not.toBe(source);
        expect(result.entries.get('self')).toBe(result);
        expect(result.entries.get('value')).toBe(5n);
        expect(source.entries.get('self')).toBe(source);
        expect(source.entries.get('value')).toBe(deferred);
    });

    it('rewires a queue cycle through an immutable tuple', () => {
        const source: RankQueue = { kind: 'queue', items: [] };
        const deferred = plan(() => 5n);
        source.items.push(tuple([source, deferred]));
        const result = materializeValue(source) as RankDeque;
        const item = result.peek() as ReturnType<typeof tuple>;
        expect(item.items[0]).toBe(result);
        expect(item.items[1]).toBe(5n);
        expect((source.items[0] as ReturnType<typeof tuple>).items[1]).toBe(deferred);
    });

    it.each(['queue', 'deque', 'stack'] as const)('preserves %s traversal and removal order', mode => {
        const source = new RankDeque(mode);
        for (const value of [1n, 2n, 3n]) source.push(plan(() => value));
        const result = materializeValue(source) as RankDeque;
        expect(result.mode).toBe(mode);
        expect([result.pop(), result.pop(), result.pop()]).toEqual(mode === 'stack' ? [3n, 2n, 1n] : [1n, 2n, 3n]);
        expect(source.size).toBe(3);
        expect(isRankPlan(source.peek())).toBe(true);
    });

    it('retains heap priorities and stable tie order when payloads change', () => {
        const source = new RankHeap();
        for (const [value, priority] of [[1n, 2n], [2n, 1n], [3n, 2n], [4n, 1n], [5n, 2n]]) {
            source.push(plan(() => value), priority);
        }
        const result = materializeValue(source) as RankHeap;
        result.push(6n, 2n);
        expect(Array.from({ length: 6 }, () => result.pop())).toEqual([2n, 4n, 1n, 3n, 5n, 6n]);
        expect(source.size).toBe(5);
        expect(isRankPlan(source.peek())).toBe(true);
    });

    it('rebuilds set keys and merges counter counts after computing values', () => {
        const first = plan(() => 7n), second = plan(() => 7n);
        const set: RankSet = { kind: 'set', entries: new Map([['first', first], ['second', second]]) };
        const result = materializeValue(set) as RankSet;
        expect([...result.entries.values()]).toEqual([7n]);
        const counter: RankCounter = { kind: 'counter', entries: new Map([
            ['first', { value: first, count: 2n }], ['second', { value: second, count: 3n }],
        ]) };
        expect([...(materializeValue(counter) as RankCounter).entries.values()]).toEqual([{ value: 7n, count: 5n }]);
        expect(set.entries.size).toBe(2);
        expect(counter.entries.size).toBe(2);
    });

    it('rejects a nested infinite sequence before altering its container', () => {
        const infinite = sequence({ name: 'endless', size: { kind: 'infinite' }, *iterate() { throw new Error('must not start'); } });
        const source = newStructure('index') as RankIndex;
        source.entries.set('first', plan(() => 1n));
        source.entries.set('last', infinite);
        expect(() => materializeValue(source)).toThrowError('cannot materialize an infinite sequence');
        expect(isRankPlan(source.entries.get('first')!)).toBe(true);
        expect(source.entries.get('last')).toBe(infinite);
    });

    it('rejects a structural array cycle without a host stack overflow', () => {
        const source: RankArray = { kind: 'array', shape: [1], items: [] };
        source.items.push(source);
        expect(() => materializeValue(source)).toThrowError(expect.objectContaining({ rankKind: 'TypeError' }));
        expect(source.items[0]).toBe(source);
    });

    it('bounds stack use on a deep graph and preserves shared leaves', () => {
        let value: RankValue = plan(() => 9n);
        for (let depth = 0; depth < 10000; depth++) {
            const next = newStructure('index') as RankIndex;
            next.entries.set('next', value);
            value = next;
        }
        let result = materializeValue(value);
        for (let depth = 0; depth < 10000; depth++) result = (result as RankIndex).entries.get('next')!;
        expect(result).toBe(9n);
    });

    it('cancels completion without changing input and recomputes on retry', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        let calls = 0;
        const deferred = plan(() => { calls++; if (calls === 1) Atomics.store(signal, 0, 1); return 3n; });
        const source = tuple(Array(2048).fill(deferred));
        expect(() => withInterrupt(signal, () => materializeValue(source))).toThrow(InterruptedError);
        const before = calls;
        expect(before).toBeGreaterThan(0);
        expect(before).toBeLessThan(2048);
        expect(source.items.every(item => item === deferred)).toBe(true);
        Atomics.store(signal, 0, 0);
        const result = materializeValue(source) as ReturnType<typeof tuple>;
        expect(result.items.every(item => item === 3n)).toBe(true);
        expect(calls).toBe(before + 2048);
    });
});

describe.each([false, true])('nested binding completion (compilation=%s)', compilation => {
    it('refines a lazy field on demand and ignores observers of a replaced field', () => {
        let current: RankValue = 1n;
        let reads = 0;
        const source = record([['values', { kind: 'array', shape: [1], items: [], containsFiles: false,
            itemAt: () => { reads++; return current; } }]]);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source);
        try {
            runtime.execute("R' = Input");
            expect(reads).toBe(0);
            const previous = source.entries.get('values') as RankArray;
            runtime.execute('R .values = array "new"');
            expect(readArrayItem(previous, 0)).toBe(1n);
            expect(source.fieldContracts?.get('values')?.elements).toEqual([{ type: 'text' }]);
            expect(runtime.execute('R .values 0')).toBe('new');
            current = 'bad';
            expect(() => readArrayItem(previous, 0)).toThrowError(/array elements/);
        } finally { runtime.dispose(); }
    });

    it.each(['', "'"])('honors assignment mode for nested plans: %s', marker => {
        let calls = 0;
        const source = tuple([record([['value', plan(() => { calls++; return 7n; })]])]);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source);
        try {
            runtime.execute(`Saved${marker} = Input`);
            expect(calls).toBe(marker ? 0 : 1);
            const saved = runtime.variables.get('Saved') as ReturnType<typeof tuple>;
            const item = (saved.items[0] as RankRecord).entries.get('value')!;
            expect(isRankPlan(item)).toBe(Boolean(marker));
            expect(source.items[0]).not.toBeUndefined();
            expect(isRankPlan((source.items[0] as RankRecord).entries.get('value')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it.each(['', "'"])('honors parameter mode for an unused nested array: %s', marker => {
        let reads = 0;
        const source = record([['values', { kind: 'array', shape: [2], items: [], containsFiles: false,
            itemAt: index => { reads++; return BigInt(index); } }]]);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source);
        try {
            runtime.execute(`fun R${marker} ignore = 11`);
            expect(runtime.execute('Input ignore')).toBe(11n);
            expect(reads).toBe(marker ? 0 : 2);
        } finally { runtime.dispose(); }
    });

    it('publishes no partial value after a nested failure', () => {
        const source = record([['first', plan(() => 1n)], ['last', plan(() => { throw new Error('nested failure'); })]]);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source);
        try {
            runtime.execute('Saved = 9');
            expect(() => runtime.execute('Saved = Input')).toThrowError('nested failure');
            expect(runtime.variables.get('Saved')).toBe(9n);
            expect(isRankPlan(source.entries.get('first')!)).toBe(true);
        } finally { runtime.dispose(); }
    });
});
