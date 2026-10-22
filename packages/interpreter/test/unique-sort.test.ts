import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type NativeFunction, type RankArray } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { numericUniqueSort } from '../src/numeric-collections.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { withInterrupt } from '../src/interrupt.js';
import { run } from './support.js';

describe('unique followed by sort', () => {
    it.each([
        'array 3 1 3 2 1', 'array 3.5 1.5 3.5', 'array true false true',
        'array "b" "a" "b"', 'array shape 0 fill 0',
        'array 9223372036854775808 1 9223372036854775808',
        '(array 3 1 3 1 2 1) reshape 2 3',
        'concat (array 3 1 3) (array 2 1)',
        '"😀a😀b"', '1 to 5',
    ])('matches separate operations for %s', input => {
        const setup = `use sequences\nV = ${input}\n`;
        expect(run(setup + 'V unique sort')).toBe(run(setup + 'U = V unique\nU sort'));
    });

    it.each(['7', '(array 1 1 2 3) reshape 2 2'])('preserves errors for %s', input => {
        const setup = `use sequences\nV = ${input}\n`;
        const error = (body: string) => {
            try { run(setup + body); } catch (cause) { return (cause as Error).message; }
            throw new Error('expected failure');
        };
        expect(error('V unique sort')).toBe(error('U = V unique\nU sort'));
    });

    it('completes a deferred sequence before sorting its retained unique values', () => {
        const setup = "use sequences\nV' = 1 to 5\n";
        expect(() => run(setup + 'V unique sort')).toThrow('sort expects text or a rank-1 array');
        expect(run(setup + 'U = V unique\nU sort')).toBe('1 2 3 4 5');
    });

    it('fuses standard function aliases and permits trailing operations', () => {
        const runtime = new Interpreter();
        const d = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nu = unique\ns = sort\nV = concat (array 3 1) (array 3 2)');
            expect(formatValue(d.run(() => runtime.execute('V u s'))!)).toBe('1 2 3');
            expect(d.numericUniqueSorts).toBe(1);
            expect(d.numericDistincts).toBe(0);
            expect(runtime.execute('V u s len')).toBe(3n);
            expect(formatValue(runtime.execute('V')!)).toBe('3 1 3 2');
        } finally { runtime.dispose(); }
    });

    it('does not recognize user functions by name', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nu = unique\ns = sort\nfun X custom\n return 99\nend');
            const custom = runtime.variables.get('custom') as NativeFunction;
            runtime.variables.set('s', { ...custom, name: 'sort' });
            expect(runtime.execute('(array 1 1) u s')).toBe(99n);
            runtime.execute('s = sort');
            runtime.variables.set('u', { ...custom, name: 'unique' });
            expect(() => runtime.execute('(array 1 1) u s')).toThrow();
        } finally { runtime.dispose(); }
    });

    it('declines opaque readers, signed zero, NaN and cancellable native sorting', () => {
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt: () => { reads++; return 1n; } };
        expect(numericUniqueSort(host)).toBeUndefined();
        expect(reads).toBe(0);
        for (const values of [[-0, 0, 1], [NaN, 1, NaN]]) {
            expect(numericUniqueSort(typedArray(new Float64Array(values)))).toBeUndefined();
        }
        const input = typedArray(new BigInt64Array([3n, 1n, 3n]));
        expect(withInterrupt(new Int32Array(new SharedArrayBuffer(4)), () => numericUniqueSort(input))).toBeUndefined();
        const sorted = numericUniqueSort(input)!;
        sorted.items[0] = 99n;
        expect(readArrayItem(input, 1)).toBe(1n);
    });

    it('matches an independent oracle on duplicate-heavy and int64 boundary values', () => {
        for (let seed = 1; seed <= 8; seed++) {
            const input = Array.from({ length: 257 }, (_, i) => BigInt((i * 7919 + seed) % (seed * 13)));
            input.push(-(1n << 63n), (1n << 63n) - 1n, 9007199254740993n, 9007199254740992n);
            const expected = [...new Set(input)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
            const output = numericUniqueSort(typedArray(new BigInt64Array(input)))!;
            expect(Array.from({ length: output.shape[0] }, (_, index) => readArrayItem(output, index)))
                .toEqual(expected);
        }
    });
});
