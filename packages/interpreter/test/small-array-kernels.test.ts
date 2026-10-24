import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, MISSING, RuntimeDiagnostics, type RankArray, type RankValue } from '../src/index.js';
import { denseScalarItems, derivedArray, ownedArray, readArrayItem, typedArray } from '../src/array-storage.js';
import { prepareStoredScalarView, registerScalarView } from '../src/integer-view.js';
import { matmulValues } from '../src/modules/linalg.js';
import { checkpoint, InterruptedError, withInterrupt } from '../src/interrupt.js';
import { sliceArray, tensorSelection } from '../src/selectors.js';

function withRuntime(check: (runtime: Interpreter) => void) {
    const runtime = new Interpreter(() => {});
    try { check(runtime); } finally { runtime.dispose(); }
}

const scalars: [string, (a: bigint, b: bigint) => RankValue][] = [
    ['+', (a, b) => a + b], ['-', (a, b) => a - b], ['*', (a, b) => a * b],
    ['//', (a, b) => a / b - (a % b < 0n ? 1n : 0n)],
    ['mod', (a, b) => (a % b + b) % b], ['**', (a, b) => a ** b],
    ['less', (a, b) => a < b], ['equal', (a, b) => a === b],
];
describe('small stored array arithmetic', () => {
    it.each(scalars)('reads %s exactly at both sides of the dense threshold', (operator, scalar) => withRuntime(runtime => {
        for (const size of [0, 1, 8, 1023, 1024]) {
            const values = Array.from({ length: size }, (_, i) => BigInt(i % 7 - 3) * (2n ** 60n + 1n));
            runtime.variables.set('A', ownedArray(values, [size], true));
            const result = runtime.execute(`A ${operator} 3`);
            if (!isRankArray(result!)) throw new Error('expected array');
            if (size < 1024 && ['less', 'equal'].includes(operator)) {
                expect(denseScalarItems(result)).toBeUndefined();
            } else expect(denseScalarItems(result)).toBeDefined();
            expect(result.items).toEqual(values.map(a => scalar(a, 3n)));
        }
    }));

    it('broadcasts small stored operands and preserves value semantics', () => withRuntime(runtime => {
        runtime.execute('A = array shape 2 1 fill 7\nB = array 1 2 3\nQ = A + B\nAlias = Q\nA 0 0 = 99\nQ 1 2 = 42');
        const alias = runtime.variables.get('Alias')!;
        if (!isRankArray(alias)) throw new Error('expected array');
        expect(alias.shape).toEqual([2, 3]);
        expect(alias.items).toEqual([8n, 9n, 10n, 8n, 9n, 10n]);
        expect(runtime.execute('Q 1 2')).toBe(42n);
    }));

    it('leaves missing cells and failures lazy and choose can skip a bad cell', () => withRuntime(runtime => {
        runtime.execute("A = array 7 7\nB = array 3 0\nQ' = A // B");
        expect(runtime.execute('Q 0')).toBe(2n);
        expect(runtime.execute('(B equal 0 choose 0 Q) sum')).toBe(2n);
        expect(() => runtime.execute('Q 1')).toThrow('division by zero');
        expect(runtime.execute('((array .NA 2) + 1) 0')).toBe(MISSING);
    }));

    it('does not probe a lazy host array to make a small operation eager', () => withRuntime(runtime => {
        const reads: number[] = [];
        runtime.variables.set('Host', { kind: 'array', shape: [2],
            itemAt(index) { reads.push(index); return BigInt(index); },
            get items(): RankValue[] { throw new Error('materialized host'); } });
        runtime.execute("Q' = Host + 1");
        expect(reads).toEqual([]);
        expect(runtime.execute('Q 1')).toBe(2n);
        expect(reads).toEqual([1]);
    }));
});

describe('vector dot', () => {
    it('accumulates exact integers beyond machine width and handles empty vectors', () => {
        const huge = 2n ** 100n + 3n;
        expect(matmulValues(ownedArray([huge, -huge, 7n], [3], true),
            ownedArray([huge, huge - 1n, -3n], [3], true))).toBe(huge - 21n);
        const empty = ownedArray([], [0], true);
        expect(matmulValues(empty, empty)).toBe(0n);
    });

    it('preserves mixed operand promotion, signed zero and accumulation order', () => {
        expect(matmulValues(typedArray(new Float64Array([1.5, 2.5]), [2]),
            ownedArray([2n, 4n], [2], true))).toBe(13);
        expect(matmulValues(typedArray(new Float64Array([1e16, -1e16, 1]), [3]),
            ownedArray([1n, 1n, 1n], [3], true))).toBe(1);
        expect(matmulValues(typedArray(new Float64Array([-0]), [1]),
            ownedArray([1n], [1], true))).toBe(0);
    });

    it.each(['plain', 'int32', 'int64'] as const)('consumes trusted reordered and duplicate %s selections without lazy cell caches', storage => {
        const source = storage === 'plain' ? ownedArray([2n, 3n, 5n], [3], true)
            : typedArray(storage === 'int32' ? new Int32Array([2, 3, 5]) : new BigInt64Array([2n, 3n, 5n]));
        const indices = ownedArray([2n, 0n, 2n], [3], true);
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            const view = sliceArray(source, tensorSelection(source, [indices]));
            expect(matmulValues(view, ownedArray([1n, -1n, 2n], [3], true))).toBe(13n);
        });
        expect(diagnostics.cellsComputed).toBe(0);
    });

    it('keeps signed compact dot products exact beyond the Number range', () => {
        const a = Int32Array.from({ length: 25000 }, (_, i) => i % 2 ? -2147483648 : 2147483647);
        const b = Int32Array.from({ length: 25000 }, (_, i) => i % 3 ? 999999937 : -123456789);
        let expected = 0n;
        for (let i = 0; i < a.length; i++) expected += BigInt(a[i]) * BigInt(b[i]);
        expect(matmulValues(typedArray(a), typedArray(b))).toBe(expected);
    });

    it('retains named gather snapshots when a source is written', () => withRuntime(runtime => {
        runtime.execute('use linalg\nWays = array 2 3 5\nTerms = Ways (array 2 0 2)\nWays 2 = 99');
        expect(runtime.execute('Terms matmul (array 1 -1 2)')).toBe(13n);
        expect(runtime.execute('Ways (array 2 0 2) matmul (array 1 -1 2)')).toBe(295n);
    }));

    it('reads host operands once, left to right, stopping at the first bad cell', () => {
        const reads: string[] = [];
        const host = (name: string): RankArray => ({ kind: 'array', shape: [3],
            itemAt(index) { reads.push(`${name}${index}`); return name === 'L' && index === 1 ? 'bad' : 2n; },
            get items(): RankValue[] { throw new Error('materialized host'); } });
        expect(() => matmulValues(host('L'), host('R'))).toThrow('numeric');
        expect(reads).toEqual(['L0', 'R0', 'L1']);
    });

    it('does not bypass an unestablished contract or a replaced view reader', () => {
        const source = ownedArray([2n, 3n], [2], true);
        let reads = 0;
        const view = registerScalarView(derivedArray([2], [source], index => {
            reads++; if (index === 1) throw new Error('contract'); return readArrayItem(source, index);
        }), source, index => index, { accepts: () => false });
        expect(prepareStoredScalarView(view)).toBeUndefined();
        expect(() => matmulValues(view, source)).toThrow('contract');
        expect(reads).toBe(2);
        const changed = registerScalarView(derivedArray([2], [source], index => readArrayItem(source, index)), source, index => index);
        Object.defineProperty(changed, 'itemAt', { value: () => 10n });
        expect(prepareStoredScalarView(changed)).toBeUndefined();
        expect(matmulValues(changed, source)).toBe(50n);
    });

    it('falls back to ordinary lazy validation for nonnumeric stored selections', () => {
        const source = ownedArray([1n, true], [2], true, ['a', 'b']);
        const make = () => registerScalarView(derivedArray([2], [source], index => readArrayItem(source, index)), source, index => index);
        const expected = make();
        readArrayItem(expected, 0);
        let message = '';
        try { readArrayItem(expected, 1); } catch (error) { message = (error as Error).message; }
        expect(message).not.toBe('');
        expect(() => matmulValues(make(), ownedArray([1n, 1n], [2], true))).toThrow(message);
    });

    it('retains mixed numeric domain failures through a table row view', () => {
        const source = ownedArray([1n, 2.0], [1, 2], true, ['integer', 'real']);
        const row = registerScalarView(derivedArray([2], [source], index => readArrayItem(source, index)),
            source, index => index);
        expect(() => matmulValues(row, ownedArray([1n, 1n], [2], true)))
            .toThrow('one element type');
    });

    it('does not borrow one side while the other can run an effect', () => {
        const source = ownedArray([1n, 2n], [2], true);
        const view = sliceArray(source, tensorSelection(source, [ownedArray([0n, 1n], [2], true)]));
        const host: RankArray = { kind: 'array', shape: [2], items: [], itemAt(index) {
            if (index === 0) source.items[1] = 100n;
            return 1n;
        } };
        expect(matmulValues(view, host)).toBe(101n);
    });

    it('checks vector dimensions and axes before reading any cells', () => {
        const host: RankArray = { kind: 'array', shape: [2], items: [], itemAt() { throw new Error('read'); } };
        expect(() => matmulValues(host, ownedArray([1n], [1], true))).toThrow('contracted dimensions');
        expect(() => matmulValues(host, host, [1, 0])).toThrow('axis out of bounds');
    });

    it('keeps trusted and host dot loops cancellable', () => {
        const source = ownedArray(Array(2048).fill(7n), [2048], true);
        const host: RankArray = { kind: 'array', shape: [2048], items: [], itemAt: () => 7n };
        for (const value of [source, host]) {
            const signal = new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => {
                checkpoint('before dot', 1023);
                return matmulValues(value, source);
            })).toThrow(InterruptedError);
        }
    });
});
