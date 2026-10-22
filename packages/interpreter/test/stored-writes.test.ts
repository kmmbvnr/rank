import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, tuple, typeName, type RankArray, type RankIndex, type RankRecord, type RankSet, type RankValue } from '../src/index.js';
import { denseScalarItems } from '../src/array-storage.js';
import { RankDeque, RankHeap } from '../src/containers.js';
import { newStructure } from '../src/collections.js';
import { sequence } from '../src/sequence.js';
import { completed } from '../src/execution.js';
import { algoModule } from '../src/modules/algo.js';
import type { RankPlan } from '../src/plan.js';
import type { RuntimeContext } from '../src/modules/types.js';

const context: RuntimeContext = { output: () => undefined, random: () => 0.5,
    seedRandom: () => undefined, ownFile: () => undefined };

function counted() {
    let reads = 0;
    return { reads: () => reads, value: sequence({ name: 'stored input', size: { kind: 'exact', value: 2n },
        *iterate() { for (const value of [2n, 3n]) { reads++; yield value; } },
    }) };
}

function record(value: RankValue): RankRecord {
    return { kind: 'record', entries: new Map([['value', value]]), types: new Map([['value', typeName(value)]]) };
}

describe.each([false, true])('stored field and container writes (compilation=%s)', compilation => {
    it('completes record fields when constructing a record expression', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            const result = runtime.execute('record\n .values = Input\nend') as RankRecord;
            expect(source.reads()).toBe(2);
            const values = result.entries.get('values') as RankArray;
            expect(values.shape).toEqual([2]);
            expect(denseScalarItems(values)).toBeDefined();
            expect(formatValue(values)).toBe('2 3');
            expect(formatValue(values)).toBe('2 3');
            expect(source.reads()).toBe(2);
        } finally { runtime.dispose(); }
    });

    it.each(['R .values = Input', 'R .values += Input', 'Updated = R with\n .values = Input\nend'])
    ('stores the final field result: %s', write => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute('R = record\n .values = array 0\nend');
            runtime.execute(write);
            const target = write.startsWith('Updated') ? 'Updated' : 'R';
            const field = (runtime.variables.get(target) as RankRecord).entries.get('values') as RankArray;
            expect(field.shape).toEqual([2]);
            expect(denseScalarItems(field)).toBeDefined();
            expect(formatValue(runtime.execute(`${target} .values`)!)).toBe('2 3');
            expect(source.reads()).toBe(2);
        } finally { runtime.dispose(); }
    });

    it.each(['I 0 = Input', 'I 0 += Input'])('stores an index result once: %s', write => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute('use algo\nI = new index\nI 0 = array 0');
            runtime.execute(write);
            const value = (runtime.variables.get('I') as RankIndex).entries.get(0) as RankArray;
            expect(value.shape).toEqual([2]);
            expect(denseScalarItems(value)).toBeDefined();
            expect(formatValue(runtime.execute('I 0')!)).toBe('2 3');
            expect(formatValue(runtime.execute('I 0')!)).toBe('2 3');
            expect(source.reads()).toBe(2);
        } finally { runtime.dispose(); }
    });

    it.each(['queue', 'stack', 'deque'])('stores one array per push into a %s', kind => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute(`use algo\nQ = new ${kind}\nQ push Input`);
            expect(source.reads()).toBe(2);
            const queue = runtime.variables.get('Q') as RankDeque;
            expect(queue.size).toBe(1);
            expect(queue.peek()).toMatchObject({ kind: 'array', shape: [2] });
            expect(formatValue(queue.peek())).toBe('2 3');
            expect(source.reads()).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('completes spread items and collection constructor items before storing them', () => {
        const first = counted(), second = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', tuple([first.value, second.value]));
        try {
            runtime.execute('use algo\nQ = new queue\nQ push unpack Input');
            expect((runtime.variables.get('Q') as RankDeque).items.map(formatValue)).toEqual(['2 3', '2 3']);
            expect(first.reads()).toBe(2);
            expect(second.reads()).toBe(2);
            const nested = counted();
            runtime.variables.set('Items', sequence({ name: 'items', size: { kind: 'exact', value: 1n },
                *iterate() { yield nested.value; },
            }));
            const result = runtime.execute('new queue Items') as RankDeque;
            expect(result.peek()).toMatchObject({ kind: 'array', shape: [2] });
            expect(nested.reads()).toBe(2);
        } finally { runtime.dispose(); }
    });

    it.each(['R .values = Input', 'I 0 = Input', 'Q push Input'])('keeps existing state on completion failure: %s', write => {
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', sequence({ name: 'failing input', size: { kind: 'exact', value: 2n },
            *iterate() { yield 1n; throw new Error('completion failed'); },
        }));
        try {
            runtime.execute('use algo\nR = record\n .values = array 9\nend\nI = new index\nI 0 = array 9\nQ = new queue\nQ push array 9');
            expect(() => runtime.execute(write)).toThrowError('completion failed');
            expect(formatValue(runtime.execute('R .values')!)).toBe('9');
            expect(formatValue(runtime.execute('I 0')!)).toBe('9');
            const queue = runtime.variables.get('Q') as RankDeque;
            expect(queue.size).toBe(1);
            expect(formatValue(queue.peek())).toBe('9');
        } finally { runtime.dispose(); }
    });
});

describe('native collection entry', () => {
    it('completes a deferred heap priority before retaining it', () => {
        let calls = 0;
        const priority: RankPlan = { kind: 'plan', dependencies: new Map(), evaluate: () => {
            calls++; return completed(1n);
        } };
        const heap = new RankHeap();
        const fn = algoModule.enqueue(context);
        if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('expected native operation');
        fn.call([heap, priority, 'first']);
        heap.push('second', 2n);
        expect(heap.pop()).toBe('first');
        expect(heap.pop()).toBe('second');
        expect(calls).toBe(1);
    });
    it.each(['push', 'pushfront', 'pushback', 'enqueue', 'add'] as const)('completes nested payloads through %s', operation => {
        let calls = 0;
        const deferred: RankPlan = { kind: 'plan', dependencies: new Map(), evaluate: () => {
            calls++; return completed(7n);
        } };
        const input = record(deferred);
        const target = operation === 'enqueue' ? new RankHeap()
            : operation === 'add' ? newStructure('set') : new RankDeque('deque');
        const fn = algoModule[operation](context);
        if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('expected native operation');
        fn.call(operation === 'enqueue' ? [target, 1n, input] : [target, input]);
        expect(calls).toBe(1);
        const stored = target instanceof RankDeque || target instanceof RankHeap ? target.peek()
            : (target as RankSet).entries.values().next().value;
        expect((stored as RankRecord).entries.get('value')).toBe(7n);
        expect(input.entries.get('value')).toBe(deferred);
    });

    it.each(['push', 'add'] as const)('rejects a bad %s receiver before completing payloads', operation => {
        let calls = 0;
        const deferred: RankPlan = { kind: 'plan', dependencies: new Map(), evaluate: () => {
            calls++; return completed(7n);
        } };
        const fn = algoModule[operation](context);
        if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('expected native operation');
        expect(() => fn.call([42n, deferred])).toThrowError(`${operation} expects`);
        expect(calls).toBe(0);
    });
});
