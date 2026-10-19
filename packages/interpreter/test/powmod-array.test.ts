import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';

function execute(source: string) {
    const runtime = new Interpreter();
    try {
        const value = runtime.execute('use numbers\nuse sequences\n' + source)!;
        return isRankArray(value) ? { shape: value.shape, items: value.items } : value;
    } finally { runtime.dispose(); }
}

describe('powmod array operands', () => {
    it('preserves the array container for a rank-zero operand', () => {
        const runtime = new Interpreter();
        runtime.variables.set('A', ownedArray([2n], []));
        try {
            const result = runtime.execute('use numbers\nA 3 7 powmod')!;
            expect(isRankArray(result)).toBe(true);
            expect((result as RankArray).shape).toEqual([]);
            expect((result as RankArray).items).toEqual([1n]);
        } finally { runtime.dispose(); }
    });
    it.each([
        ['Ks Ks 250 powmod', [1n, 4n, 27n]],
        ['Ks 2 250 powmod', [1n, 4n, 9n]],
        ['2 Ks 250 powmod', [2n, 4n, 8n]],
        ['2 3 Ks powmod', [0n, 0n, 2n]],
        ['Ks Ks Ks powmod', [0n, 0n, 0n]],
    ])('maps %s', (source, items) => {
        expect(execute('Ks = array 1 2 3\n' + source)).toEqual({ shape: [3], items });
    });

    it('broadcasts all three operand shapes', () => {
        expect(execute(`A = (array 2 3) reshape 2 1
B = array 0 1 2
A B 5 powmod`)).toEqual({ shape: [2, 3], items: [1n, 2n, 4n, 1n, 3n, 4n] });
        expect(() => execute('(array 1 2) (array 1 2 3) 5 powmod')).toThrow('shape mismatch');
        expect(execute('Ks = array shape 0 fill 0\nKs 2 5 powmod')).toEqual({ shape: [0], items: [] });
        expect(() => execute('(array 1.0 2.5) 2 7 powmod')).toThrow('expected integer input');
    });

    it('retains exact scalar arithmetic and modular edge cases', () => {
        const huge = 2n ** 100n + 3n;
        expect(execute(`(array ${huge} ${-huge}) 2 7 powmod`)).toEqual({ shape: [2], items: [4n, 4n] });
        expect(execute('(array -2 5) 0 1 powmod')).toEqual({ shape: [2], items: [0n, 0n] });
        expect(execute('-2 3 5 powmod')).toBe(2n);
    });

    it.each([
        ['A (array 1 -1) 7 powmod', 'powmod exponent must be nonnegative'],
        ['A 2 (array 7 0) powmod', 'powmod modulus must be positive'],
        ['(array 2 .NA) 2 7 powmod', 'missing value where an integer is needed'],
    ])('defers invalid cells in %s', (expression, message) => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers\nA = array 2 3\nQ = ' + expression);
            expect(runtime.execute('Q 0')).toBeGreaterThanOrEqual(0n);
            expect(() => runtime.execute('Q 1')).toThrow(message);
        } finally { runtime.dispose(); }
    });

    it('does not speculate host cells and refreshes after a host write', () => {
        const runtime = new Interpreter();
        const reads: number[] = [];
        runtime.variables.set('Host', { kind: 'array', shape: [2], items: [],
            itemAt(index) { reads.push(index); return BigInt(index + 2); } });
        try {
            runtime.execute('use numbers\nQ = Host 2 7 powmod');
            expect(reads).toEqual([]);
            expect(runtime.execute('Q 1')).toBe(2n);
            expect(reads).toEqual([1]);
            runtime.execute('A = array 2 3\nB = A 2 7 powmod');
            expect(runtime.execute('B 0')).toBe(4n);
            (runtime.variables.get('A') as RankArray).items[0] = 4n;
            expect(runtime.execute('B 0')).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('retains value semantics across language writes and rejects implicit sequences', () => {
        expect(execute('A = array 2 3\nQ = A 2 7 powmod\nA 0 = 4\nQ')).toEqual({ shape: [2], items: [4n, 2n] });
        expect(() => execute('(1 to 3) 2 7 powmod')).toThrow('expected integer input');
    });
});
