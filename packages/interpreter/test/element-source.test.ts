import { expect, it, vi } from 'vitest';
import { elementSourceProtocols } from '@arrrank/language';
import { elementSource, type ElementSource } from '../src/element-source.js';
import { sumElements, sumValue } from '../src/modules/numbers.js';
import { RankDeque, RankHeap } from '../src/containers.js';
import { sequence } from '../src/sequence.js';
import { MISSING, type RankValue } from '../src/value.js';

it('sums an implementation that provides only the element-source interface', () => {
    const reads: number[] = [];
    const source: ElementSource = { *values() {
        for (const [index, item] of [9007199254740993n, 1n, MISSING, -9007199254740993n].entries()) {
            reads.push(index);
            yield item;
        }
    } };
    expect(sumElements(source)).toBe(1n);
    expect(reads).toEqual([0, 1, 2, 3]);
    expect(sumElements({ *values() { yield 1e16; yield 1; yield -1e16; } })).toBe(0);
    expect(sumElements({ *values() {} })).toBe(0n);
});

it('connects every declared source kind to a runtime adapter', () => {
    const values = [1n, 2n, 3n];
    const collection = (mode: 'queue' | 'stack' | 'deque') => {
        const value = new RankDeque(mode);
        values.forEach(item => value.push(item));
        return value;
    };
    const sources: Record<keyof typeof elementSourceProtocols, RankValue> = {
        array: { kind: 'array', shape: [3], items: values },
        bytes: { kind: 'bytes', shape: [3], items: values, data: new Uint8Array([1, 2, 3]) },
        sequence: sequence({ name: 'test', size: { kind: 'exact', value: 3n }, *iterate() { yield* values; } }),
        queue: collection('queue'), stack: collection('stack'), deque: collection('deque'),
        set: { kind: 'set', entries: new Map(values.map(item => [String(item), item])) },
    };
    for (const [kind, value] of Object.entries(sources)) {
        expect(elementSource(value, 'sum'), kind).toBeDefined();
        expect(sumValue(value), kind).toBe(6n);
    }
    expect(sumValue({ kind: 'queue', items: values })).toBe(6n);
    expect(elementSource(new RankHeap(), 'sum')).toBeUndefined();
    expect(() => sumValue(new RankHeap())).toThrow('expected numeric input');
});

it('preserves planned reductions without consuming the sequence', () => {
    const iterate = vi.fn(function* () { throw new Error('should not iterate'); });
    const value = sequence({ name: 'planned', size: { kind: 'exact', value: 3n }, iterate,
        reduce: operation => operation === 'sum' ? 6n : undefined });
    expect(sumValue(value)).toBe(6n);
    expect(iterate).not.toHaveBeenCalled();
});

it('rejects infinite fallback traversal before reading elements', () => {
    const iterate = vi.fn(function* () { yield 1n; });
    const value = sequence({ name: 'infinite', size: { kind: 'infinite' }, iterate });
    expect(() => sumValue(value)).toThrow('sum requires a bounded sequence');
    expect(iterate).not.toHaveBeenCalled();
});

it('does not probe storage while constructing an adapter or hide read failures', () => {
    const items = vi.fn(() => { throw new Error('storage failure'); });
    const value: RankValue = { kind: 'array', shape: [2], get items() { return items(); } };
    expect(elementSource(value, 'sum')).toBeDefined();
    expect(items).not.toHaveBeenCalled();
    expect(() => sumValue(value)).toThrow('storage failure');
    expect(sumValue(MISSING)).toBe(0n);
    expect(sumValue(5n)).toBe(5n);
    expect(() => sumElements({ *values() { yield 1n; yield 'bad'; throw new Error('read too far'); } }))
        .toThrow('expected numeric input');
});
