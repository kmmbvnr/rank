import { describe, expect, it } from 'vitest';
import { prepareCaptureProtection } from '../src/capture-protection.js';
import { checkValueMutable } from '../src/value-protection.js';
import { derivedArray, ownedArray } from '../src/array-storage.js';
import { RankDeque, RankHeap } from '../src/containers.js';
import { RankDsu } from '../src/dsu.js';
import { GraphValue } from '../src/graph.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { sequence } from '../src/sequence.js';
import type { RankIndex, RankRecord, RankValue } from '../src/value.js';

const record = (): RankRecord => ({ kind: 'record', entries: new Map([['value', 1n]]), types: new Map([['value', 'integer']]) });

describe('captured data protection', () => {
    it('publishes a cyclic/shared graph atomically and protects storage aliases', () => {
        const child = record();
        const index: RankIndex = { kind: 'index', entries: new Map() };
        index.entries.set('self', index);
        index.entries.set('child', child);
        const publish = prepareCaptureProtection(index, 'captured');
        expect(() => checkValueMutable(child)).not.toThrow();
        expect(() => checkValueMutable(index)).not.toThrow();
        publish();
        expect(() => checkValueMutable(child)).toThrowError('captured');
        expect(() => checkValueMutable({ ...child })).toThrowError('captured');
        expect(() => checkValueMutable(index)).toThrowError('captured');
    });

    it('does not demand lazy cells while protecting declared dependencies', () => {
        let reads = 0;
        const child = record();
        const array = derivedArray([2], [child], () => { reads++; return child; });
        prepareCaptureProtection(array, 'captured')();
        expect(reads).toBe(0);
        expect(() => checkValueMutable(child)).toThrowError('captured');
    });

    it('keeps native single-pass resource state mutable and does not advance it', () => {
        let reads = 0;
        const queue = new RankDeque();
        const stream = sequence({ name: 'resource', singlePass: true, size: { kind: 'unknown' },
            captures: [new Map([['state', queue]])],
            *iterate() { reads++; queue.push(1n); yield queue.pop(); },
        });
        prepareCaptureProtection(stream, 'captured')();
        expect(reads).toBe(0);
        expect([...stream.plan.iterate()]).toEqual([1n]);
    });

    it('does not freeze any prefix after cancellation during preparation', () => {
        const children = Array.from({ length: 2048 }, record);
        const root = ownedArray(children);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => prepareCaptureProtection(root, 'captured'))).toThrow(InterruptedError);
        expect(() => checkValueMutable(children[0])).not.toThrow();
        expect(() => checkValueMutable(children.at(-1)!)).not.toThrow();
    });

    it.each([
        ['queue', () => new RankDeque(), (value: RankValue) => (value as RankDeque).push(1n)],
        ['heap', () => new RankHeap(), (value: RankValue) => (value as RankHeap).push(1n)],
        ['dsu', () => new RankDsu(true), (value: RankValue) => (value as RankDsu).merge(1n, 2n)],
        ['graph', () => new GraphValue(true, true), (value: RankValue) => (value as GraphValue).addEdge(1n, 2n)],
    ] as const)('guards native %s mutators too', (_name, create, mutate) => {
        const value = create();
        prepareCaptureProtection(value, 'captured')();
        expect(() => mutate(value)).toThrowError('captured');
        expect(value.size).toBe(0);
    });
});
