import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, isNativeFunction, type RankValue } from '../src/index.js';
import { denseScalarItems, ownedArray, typedArray, typedElementKind } from '../src/array-storage.js';

for (const compilation of [false, true]) describe(`stored integer extrema (compilation=${compilation})`, () => {
    it.each(['min', 'max'])('%s broadcasts exactly beyond int64 and preserves aliases', operation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const huge = 2n ** 100n;
            const a = [huge, -huge];
            const b = [7n, 0n, -9n];
            runtime.variables.set('A', ownedArray([...a], [2, 1], true));
            runtime.variables.set('B', ownedArray(b, [1, 3], true));
            runtime.execute(`Q = ${operation === 'min' ? 'A B min' : 'A max B'}\nAlias = Q\nA 0 0 = 99`);
            const result = runtime.variables.get('Alias')!;
            expect(isRankArray(result)).toBe(true);
            if (!isRankArray(result)) throw Error('expected array');
            expect(result.shape).toEqual([2, 3]);
            expect(result.items).toEqual(a.flatMap(x => b.map(y => operation === 'min' ? (y < x ? y : x) : (y > x ? y : x))));
            expect(runtime.execute(`(${operation === 'min' ? '7 (array 2 9) min' : '7 max (array 2 9)'}) sum`)).toBe(operation === 'min' ? 9n : 16n);
        } finally { runtime.dispose(); }
    });

    it('does not bypass a replaced native implementation', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('op = min\nA = array 2 3');
            const operation = runtime.variables.get('op')!;
            if (!isNativeFunction(operation)) throw Error('expected native');
            Object.defineProperty(operation, 'call', { value: () => 7n });
            expect(runtime.execute('(A A op) sum')).toBe(14n);
        } finally { runtime.dispose(); }
    });

    it('keeps mixed numeric types and lazy failures on the general path', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('A', ownedArray([1n, 5n], [2], true));
            runtime.variables.set('B', ownedArray([0.5, 3.5], [2], true));
            expect(runtime.execute('(A B min) sum')).toBe(4);
            expect(runtime.execute('(A max B) sum')).toBe(6n);
            const reads: number[] = [];
            runtime.variables.set('Host', { kind: 'array', shape: [2],
                itemAt(index: number): RankValue { reads.push(index); if (index === 1) throw Error('bad cell'); return 3n; },
                get items(): RankValue[] { throw Error('materialized host'); } });
            runtime.execute("Q' = Host A min");
            expect(reads).toEqual([]);
            expect(runtime.execute('Q 0')).toBe(1n);
            expect(() => runtime.execute('Q 1')).toThrow('bad cell');
        } finally { runtime.dispose(); }
    });
});

for (const compilation of [false, true]) describe(`stored integer choose (compilation=${compilation})`, () => {
    it('reads bitmap tails, broadcasts all three operands, and preserves snapshots', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const flags = Array.from({ length: 33 }, (_, i) => i % 2 === 0);
            const huge = 2n ** 100n;
            runtime.variables.set('Mask', ownedArray(flags, [1, 33], true));
            runtime.variables.set('Yes', ownedArray([huge, -huge], [2, 1], true));
            runtime.variables.set('No', ownedArray(Array.from({ length: 33 }, (_, i) => BigInt(i)), [33], true));
            runtime.execute('Q = Mask choose Yes No\nMask 0 0 = false\nYes 0 0 = 7');
            const result = runtime.variables.get('Q')!;
            if (!isRankArray(result)) throw Error('expected array');
            expect(result.shape).toEqual([2, 33]);
            expect(result.items).toEqual([huge, -huge].flatMap(x => flags.map((flag, i) => flag ? x : BigInt(i))));
            expect(runtime.execute('(true choose No 9) sum')).toBe(528n);
            expect(runtime.execute('(false choose No 9) sum')).toBe(297n);
            expect(runtime.execute('((array true false) choose 8 3) sum')).toBe(11n);
            expect(runtime.execute('((array shape 0 fill true) choose 1 0) len')).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it('retains mixed-type validation and rejects non-boolean conditions', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use sequences');
            expect(() => runtime.execute('((array true false) choose 1 2.5) copy')).toThrow('one element type');
            expect(() => runtime.execute('((array 1 0) choose 7 9) copy')).toThrow('boolean condition');
            expect(() => runtime.execute('((array true false) choose (array 1 2 3) 0) copy')).toThrow('shape mismatch');
        } finally { runtime.dispose(); }
    });

    it('does not inspect an unselected host branch or stale mask reader', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const reads: number[] = [];
            runtime.variables.set('Host', { kind: 'array', shape: [2],
                itemAt(index: number): RankValue { reads.push(index); if (index === 0) throw Error('unselected'); return 9n; },
                get items(): RankValue[] { throw Error('materialized host'); } });
            const mask = ownedArray([true, false], [2], true);
            runtime.variables.set('Mask', mask);
            expect(runtime.execute('(Mask choose 7 Host) sum')).toBe(16n);
            expect(reads).toEqual([1]);
            Object.defineProperty(mask, 'itemAt', { value: () => false });
            expect(runtime.execute('(Mask choose 7 9) sum')).toBe(18n);
        } finally { runtime.dispose(); }
    });
});

describe('completed numeric copy', () => {
    it.each([new Int32Array([1, 2]), new BigInt64Array([1n, 2n]), new Float64Array([1.5, -0])])(
        'keeps a numeric buffer typed and independent', data => {
            const runtime = new Interpreter();
            try {
                const source = typedArray(data, [1, 2]);
                runtime.variables.set('Input', source);
                const copied = runtime.execute('use sequences\nInput copy')!;
                if (!isRankArray(copied)) throw Error('expected array');
                expect(copied.shape).toEqual([1, 2]);
                expect(typedElementKind(copied)).toBe(typedElementKind(source));
                expect(Array.from(denseScalarItems(copied)!)).toEqual(Array.from(denseScalarItems(source)!));
                copied.items[0] = data instanceof Float64Array ? 9.5 : 9n;
                expect(source.items[0]).toBe(data instanceof Float64Array ? 1.5 : 1n);
                source.items[1] = data instanceof Float64Array ? 8.5 : 8n;
                expect(copied.items[1]).toBe(data instanceof Float64Array ? -0 : 2n);
            } finally { runtime.dispose(); }
        });
});
