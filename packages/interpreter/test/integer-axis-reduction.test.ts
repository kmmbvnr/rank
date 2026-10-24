import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

for (const compilation of [true, false]) describe(`integer axis sums (compilation=${compilation})`, () => {
    it.each([0, 1, 2])('sums axis %s of a packed tensor without scalar cell evaluation', axis => {
        const runtime = new Interpreter(undefined, { compilation });
        const shape = [3, 4, 5];
        const data = Int32Array.from({ length: 60 }, (_, i) => i % 3 === 0 ? -2147483648 : 2147483647);
        runtime.variables.set('A', typedArray(data, shape));
        try {
            runtime.execute('use sequences');
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute(`A reduce + axis ${axis}`)) as RankArray;
            const expected = Array<bigint>(60 / shape[axis]).fill(0n);
            for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 5; k++) {
                const frame = axis === 0 ? j * 5 + k : axis === 1 ? i * 5 + k : i * 4 + j;
                expected[frame] += BigInt(data[(i * 4 + j) * 5 + k]);
            }
            expect(result.shape).toEqual(shape.filter((_, i) => i !== axis));
            expect([...result.items]).toEqual(expected);
            expect(diagnostics.cellsComputed).toBe(0);
            expect(diagnostics.typedUnpacks).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('adds an arbitrary precision seed exactly, including cancellation near 2^53', () => {
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('A', typedArray(new Int32Array([2147483647, -2147483648, 2147483647, -2147483648]), [2, 2]));
        try {
            runtime.execute('use sequences');
            for (const seed of [9007199254740991n, -9007199254740991n, 1n << 100n]) {
                runtime.variables.set('Seed', seed);
                const result = runtime.execute('A reduce + axis 0 with Seed') as RankArray;
                expect([...result.items]).toEqual([seed + 4294967294n, seed - 4294967296n]);
            }
        } finally { runtime.dispose(); }
    });

    it('preserves empty axes, empty frames, scalar results and real seeds', () => {
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('E', typedArray(new Int32Array(0), [2, 0, 3]));
        runtime.variables.set('V', typedArray(new Int32Array([1, 2, -4]), [3]));
        try {
            runtime.execute('use sequences');
            expect([...(runtime.execute('E reduce + axis 1') as RankArray).items]).toEqual(Array(6).fill(0n));
            expect([...(runtime.execute('E reduce + axis 1 with 7') as RankArray).items]).toEqual(Array(6).fill(7n));
            const empty = runtime.execute('E reduce + axis 0') as RankArray;
            expect(empty.shape).toEqual([0, 3]);
            expect([...empty.items]).toEqual([]);
            expect(runtime.execute('V reduce + axis 0')).toBe(-1n);
            expect(runtime.execute('V reduce + axis 0 with 0.5')).toBe(-0.5);
        } finally { runtime.dispose(); }
    });

    it('retains scalar read order for host arrays', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const reads: number[] = [];
        runtime.variables.set('A', { kind: 'array', shape: [2, 2], items: [],
            itemAt: index => { reads.push(index); return BigInt(index + 1); } });
        try {
            const result = runtime.execute('use sequences\nA reduce + axis 0') as RankArray;
            expect([...result.items]).toEqual([4n, 6n]);
            expect(reads).toEqual([0, 2, 1, 3]);
        } finally { runtime.dispose(); }
    });

    it('keeps wider integers, multiple axes and named operations exact', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const high = (1n << 63n) - 1n;
        runtime.variables.set('A', typedArray(new BigInt64Array([high, -high, high, -high]), [2, 2]));
        try {
            runtime.execute('use sequences\nfun A plus B\n return A + B\nend');
            const result = runtime.execute('A reduce + axis 0') as RankArray;
            expect([...result.items]).toEqual([2n * high, -2n * high]);
            expect([...(runtime.execute('A reduce plus axis 0') as RankArray).items]).toEqual([...result.items]);
            expect(runtime.execute('A reduce + axis 1 0 with 7')).toBe(7n);
        } finally { runtime.dispose(); }
    });
});

it('falls back when the Int32 partial-sum bound exceeds exact double integers', () => {
    const runtime = new Interpreter();
    const length = 4194305;
    const data = new Int32Array(length).fill(-2147483648);
    data[length - 1]++;
    runtime.variables.set('A', typedArray(data, [length]));
    try {
        expect(runtime.execute('use sequences\nA reduce + axis 0'))
            .toBe(-2147483648n * BigInt(length) + 1n);
    } finally { runtime.dispose(); }
}, 30000);

it('polls cancellation during a packed sum without changing the source', () => {
    const runtime = new Interpreter();
    const source = typedArray(new Int32Array(100000).fill(2), [100, 1000]);
    runtime.variables.set('A', source);
    runtime.execute('use sequences\nfun A total\n return A reduce + axis 0\nend');
    const operation = runtime.variables.get('total') as { call(args: RankArray[]): RankArray };
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(signal, 0, 1);
    try {
        expect(() => withInterrupt(signal, () => operation.call([source]))).toThrow(InterruptedError);
        expect(readArrayItem(source, 0)).toBe(2n);
        expect(readArrayItem(source, 99999)).toBe(2n);
    } finally { runtime.dispose(); }
});
