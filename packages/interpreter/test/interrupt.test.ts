import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction, type RankArray } from '../src/index.js';
import { checkpoint, InterruptedError, interruptsEnabled, interruptibleCallback, interruptibleValues, withInterrupt } from '../src/interrupt.js';
import { sortValue } from '../src/modules/sequences.js';
import { linalgModule } from '../src/modules/linalg.js';
import { graphModule } from '../src/modules/graph.js';
import { native } from '../src/modules/shared.js';
import { GraphValue } from '../src/graph.js';
import { derivedArray } from '../src/array-storage.js';
import { compileTensorCellCopy } from '../src/tensor-cell-compiler.js';

function cancel<T>(run: () => T): T {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(signal, 0, 1);
    return withInterrupt(signal, run);
}

const context = { output() {}, random: Math.random, seedRandom() {}, ownFile() {} };

const vector = (size: number): RankArray => ({ kind: 'array', shape: [size], items: Array.from({ length: size }, (_, i) => BigInt(size - i)) });

describe('interactive host cancellation', () => {
    it('is absent by default, and restores the outer mode after cancellation', () => {
        const call = (value: number) => value + 1;
        const values = [1, 2, 3];
        expect(interruptsEnabled()).toBe(false);
        expect(interruptibleCallback(call, 'test')).toBe(call);
        expect(interruptibleValues(values, 'test')).toBe(values);
        expect(() => cancel(() => checkpoint('test', 1024))).toThrow(InterruptedError);
        expect(interruptsEnabled()).toBe(false);
        expect(() => checkpoint('test', 1024)).not.toThrow();
    });

    it('honors a request made during a native call before executing the following instruction', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const runtime = new Interpreter();
        runtime.variables.set('blocking', native('blocking', 0, () => {
            Atomics.store(signal, 0, 1);
            return 42n;
        }));
        try {
            expect(() => withInterrupt(signal, () => runtime.execute('blocking\nAfter = 1'))).toThrow(/blocking/);
            expect(runtime.variables.has('After')).toBe(false);
            expect(runtime.execute('7')).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('interrupts native binomial calls and leaves ordinary numeric execution usable', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers');
        try {
            expect(() => cancel(() => runtime.execute('1000000 500000 binomial'))).toThrow(/binomial/);
            expect(() => cancel(() => runtime.execute('1000000 2 1000000007 binomialmod'))).toThrow(InterruptedError);
            expect(runtime.execute('2000 2 1000000007 binomialmod')).toBe(1999000n);
            expect(runtime.execute('30 2 binomial')).toBe(435n);
        } finally { runtime.dispose(); }
    });

    it('interrupts sorting without modifying the input array', () => {
        const input = vector(8192);
        const before = [...input.items];
        expect(() => cancel(() => sortValue(input))).toThrow(/sorting/);
        expect(input.items).toEqual(before);
        expect(sortValue(input)).toMatchObject({ kind: 'array' });
        expect(input.items).toEqual(before);
    });

    it('interrupts matrix elimination without modifying the coefficient matrix', () => {
        const size = 40;
        const items = Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 2n : 1n);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        let requested = false;
        const input: RankArray = { kind: 'array', shape: [size, size], get items() {
            if (!requested) { Atomics.store(signal, 0, 1); requested = true; }
            return items;
        } };
        const before = [...items];
        const det = linalgModule.det(context);
        if (!isNativeFunction(det)) throw new Error('missing det');
        expect(() => withInterrupt(signal, () => det.call([input]))).toThrow(/linear algebra/);
        expect(items).toEqual(before);
        expect(det.call([{ kind: 'array', shape: [2, 2], items: [2n, 1n, 1n, 2n] }])).toBe(3n);
    });

    it('interrupts graph traversal without damaging the graph', () => {
        const graph = new GraphValue(false, true);
        for (let i = 0; i < 4096; i++) graph.addEdge(BigInt(i), BigInt(i + 1));
        const bfs = graphModule.bfs(context);
        if (!isNativeFunction(bfs)) throw new Error('missing bfs');
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const get = graph.adjacency.get.bind(graph.adjacency);
        let requested = false;
        graph.adjacency.get = key => {
            if (!requested) { Atomics.store(signal, 0, 1); requested = true; }
            return get(key);
        };
        expect(() => withInterrupt(signal, () => bfs.call([graph, 0n]))).toThrow(/traversing graph/);
        expect(graph.size).toBe(4097);
        expect(bfs.call([graph, 0n])).toMatchObject({ kind: 'record' });
    });

    it('can finish materializing a derived array after cancellation without caching a partial result', () => {
        const value = derivedArray([4096], [], index => BigInt(index), true);
        expect(() => cancel(() => value.items)).toThrow(/materializing array/);
        expect(value.items).toEqual(Array.from({ length: 4096 }, (_, index) => BigInt(index)));
    });

    it('uses separate tensor copy kernels in interactive and ordinary execution', () => {
        const source = vector(8192);
        const ordinary = compileTensorCellCopy(1, [0])!;
        expect(ordinary(source, [0], [8192])).toEqual(source.items);
        expect(() => cancel(() => compileTensorCellCopy(1, [0])!(source, [0], [8192]))).toThrow(/copying tensor cell/);
        expect(compileTensorCellCopy(1, [0])).toBe(ordinary);
        expect(ordinary(source, [0], [8192])).toEqual(source.items);
    });

    it('switches a cached fused tensor between ordinary and interactive execution', () => {
        const generated: string[] = [];
        const runtime = new Interpreter(undefined, { onTensorKernelCompiled: source => generated.push(source) });
        runtime.execute('use numbers\nfun squares A\n  Squared = A * A\n  return Squared sum\nend');
        const input = vector(8192);
        runtime.variables.set('A', input);
        try {
            const expected = input.items.reduce<bigint>((sum, value) => sum + (value as bigint) ** 2n, 0n);
            expect(runtime.execute('A squares')).toBe(expected);
            expect(generated.length).toBeGreaterThan(0);
            expect(generated.at(-1)).not.toContain('checkpoint(');
            expect(() => cancel(() => runtime.execute('A squares'))).toThrow(/computing tensor/);
            expect(generated.at(-1)).toContain('checkpoint(');
            expect(runtime.execute('A squares')).toBe(expected);
            expect(generated.at(-1)).not.toContain('checkpoint(');
        } finally { runtime.dispose(); }
    });

    it('interrupts full formatting of an eager array', () => {
        const source = vector(8192);
        expect(() => cancel(() => formatValue(source))).toThrow(/formatting result/);
        expect(formatValue({ kind: 'array', shape: [2], items: [1n, 2n] })).toBe('1 2');
    });
});
