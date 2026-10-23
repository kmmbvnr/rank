import { describe, expect, it, vi } from 'vitest';
import { Interpreter, isRankArray, type RankArray } from '../src/index.js';
import * as primality from '../src/primality.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';
import { ownedArray } from '../src/array-storage.js';

function execute(source: string) {
    const runtime = new Interpreter();
    try {
        const result = runtime.execute('use numbers\nuse sequences\n' + source)!;
        return isRankArray(result) ? { shape: result.shape, items: result.items } : result;
    } finally { runtime.dispose(); }
}

describe('binomialmod array operands', () => {
    it.each([
        ['(array 5 6) 2 7 binomialmod', [3n, 1n]],
        ['6 (array 0 1 2 6) 7 binomialmod', [1n, 6n, 1n, 1n]],
        ['(array 5 6) (array 1 2) 7 binomialmod', [5n, 1n]],
    ])('maps %s', (source, items) => {
        expect(execute(source)).toEqual({ shape: [items.length], items });
    });

    it('broadcasts N and K and preserves zero-sized results', () => {
        expect(execute('N = (array 5 6) reshape 2 1\nK = array 0 1 2\nN K 7 binomialmod'))
            .toEqual({ shape: [2, 3], items: [1n, 5n, 3n, 1n, 6n, 1n] });
        expect(execute('(array shape 0 fill 0) 0 7 binomialmod')).toEqual({ shape: [0], items: [] });
        expect(() => execute('(array 5 6) (array 0 1 2) 7 binomialmod')).toThrow('shape mismatch');
    });

    it('preserves rank-zero array containers', () => {
        const runtime = new Interpreter();
        runtime.variables.set('N', ownedArray([5n], []));
        try {
            const result = runtime.execute('use numbers\nN 2 7 binomialmod') as RankArray;
            expect(isRankArray(result)).toBe(true);
            expect(result.shape).toEqual([]);
            expect(result.items).toEqual([3n]);
        } finally { runtime.dispose(); }
    });

    it('agrees with exact binomials on a broadcast grid', () => {
        expect(execute('N = ((20 to 40) copy) reshape 21 1\nK = (0 to 20) copy\n' +
            '((N K 101 binomialmod) equal ((N binomial K) mod 101)) all')).toBe(true);
    });

    it.each([
        ['(array 5 6) (array 2 7) 7 binomialmod', '0 at most K at most N'],
        ['(array 5 7) 2 7 binomialmod', 'requires N less than its modulus'],
        ['(array 5 -1) 0 7 binomialmod', '0 at most K at most N'],
        ['(array 5 .NA) 2 7 binomialmod', 'missing value where an integer is needed'],
        ['(array 5.0 6.5) 2 7 binomialmod', 'expected integer input'],
        ['(array 5 6) 2 8 binomialmod', 'modulus must be prime'],
        ['(array 5 6) 2 (array 7 11) binomialmod', 'expected integer input'],
        ['(1 to 3) 0 7 binomialmod', 'expected integer input'],
    ])('rejects invalid operands in %s', (source, message) => {
        expect(() => execute(source)).toThrow(message);
    });

    it('defers host cells and invalid unread cells', () => {
        const runtime = new Interpreter();
        const reads: number[] = [];
        runtime.variables.set('Host', { kind: 'array', shape: [2], items: [],
            itemAt(index) { reads.push(index); return index ? -1n : 5n; } });
        try {
            runtime.execute("use numbers\nQ' = Host 2 7 binomialmod");
            expect(reads).toEqual([]);
            expect(runtime.execute('Q 0')).toBe(3n);
            expect(reads).toEqual([0]);
            expect(() => runtime.execute('Q 1')).toThrow('0 at most K at most N');
        } finally { runtime.dispose(); }
    });

    it('retains deferred domain errors in completed storage', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute("use numbers\nN = array 5 -1\nQ' = N 2 7 binomialmod");
            expect(runtime.execute('Q 0')).toBe(3n);
            expect(() => runtime.execute('Q 1')).toThrow('0 at most K at most N');
        } finally { runtime.dispose(); }
    });

    it('keeps exact results for moduli and residues above signed 64-bit storage', () => {
        expect(execute('N = array 100 101\nM = 18446744073709551557\n' +
            '((N 50 M binomialmod) equal ((N binomial 50) mod M)) all')).toBe(true);
        expect(() => execute('(array 5 9007199254740992) 0 18446744073709551557 binomialmod'))
            .toThrow('N is too large to cache');
    });

    it('checks the modulus once per stored array call, including a warm cache', () => {
        const runtime = new Interpreter();
        const check = vi.spyOn(primality, 'probablePrime');
        try {
            runtime.execute('use numbers\nN = array 5 6 7');
            runtime.execute('N 2 1009 binomialmod');
            expect(check).toHaveBeenCalledTimes(1);
            runtime.execute('N 2 1009 binomialmod');
            expect(check).toHaveBeenCalledTimes(2);
        } finally { check.mockRestore(); runtime.dispose(); }
    });

    it('extends a cold cache for unsorted N values', () => {
        expect(execute('N = array 40 0 90 5 20\nK = array 20 0 45 2 10\n' +
            '((N K 103 binomialmod) equal ((N binomial K) mod 103)) all')).toBe(true);
    });

    it('charges the stored pass to the demand budget without publishing a partial result', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers\nN = array shape 8192 fill 6');
            expect(() => withDemandBudget(100, () => runtime.execute('Q = N 2 7 binomialmod')))
                .toThrow(DemandBudgetExhausted);
            expect(runtime.variables.has('Q')).toBe(false);
            expect(runtime.execute('(N 2 7 binomialmod) sum')).toBe(8192n);
        } finally { runtime.dispose(); }
    });

    it('retains value semantics across writes', () => {
        expect(execute('N = array 5 6\nQ = N 2 7 binomialmod\nN 0 = 3\nQ'))
            .toEqual({ shape: [2], items: [3n, 1n] });
    });
});
