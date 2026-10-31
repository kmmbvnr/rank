import { describe, expect, it } from 'vitest';
import { DemandBudgetExhausted, Interpreter, isRankArray, withDemandBudget, type RankArray } from '../src/index.js';
import { denseScalarItems, integer32Cells, ownedArray } from '../src/array-storage.js';
import { modularPower } from '../src/primality.js';

function execute(source: string) {
    const runtime = new Interpreter();
    try {
        const value = runtime.execute('use numbers\nuse sequences\n' + source)!;
        return isRankArray(value) ? { shape: value.shape, items: value.items } : value;
    } finally { runtime.dispose(); }
}

describe('powmod array operands', () => {
    it('writes completed integer operands to stored cells', () => {
        const runtime = new Interpreter();
        try {
            const result = runtime.execute('use numbers\nuse sequences\nA = (2 to 8193) copy\nA 3 135707531 powmod') as RankArray;
            expect(denseScalarItems(result)).toBeDefined();
            expect(integer32Cells(result)).toBeDefined();
            expect(result.items[0]).toBe(8n);
            expect(result.items[8191]).toBe(8193n ** 3n % 135707531n);
        } finally { runtime.dispose(); }
    });

    it('matches the scalar power for packed bases in lockstep', () => {
        const check = (base: string, e: number, m: number) => {
            const runtime = new Interpreter();
            try {
                const out = runtime.execute(`use numbers\nuse sequences\nA = ${base} copy\nA ${e} ${m} powmod`) as RankArray;
                const input = (runtime.variables.get('A') as RankArray).items.map(BigInt);
                expect(Array.from(out.items, BigInt)).toEqual(
                    input.map(x => modularPower(x, BigInt(e), BigInt(m))));
            } finally { runtime.dispose(); }
        };
        check('(-3 to 9)', 13, 1000000087);
        check('(0 to 6)', 0, 1000000087);
        check('(0 to 10)', 5, 1);
        check('(1000000080 to 1000000094)', 1000000085, 1000000087);
        check('(2 to 4098)', 4294967295, 1073741824);
    });

    it('borrows signed 64-bit inputs exactly within the safe Number range', () => {
        const runtime = new Interpreter();
        const inputs = [-(2n ** 53n - 1n), 2n ** 53n - 1n, -4294967297n, 4294967297n, -1n, 0n];
        const bases = Array.from({ length: 8192 }, (_, i) => inputs[i % inputs.length]);
        runtime.variables.set('A', ownedArray(bases, [8192]));
        try {
            const result = runtime.execute('use numbers\nA 3 135707531 powmod') as RankArray;
            expect(integer32Cells(result)).toBeDefined();
            expect(result.items).toEqual(bases.map(base => modularPower(base, 3n, 135707531n)));
        } finally { runtime.dispose(); }
    });

    it('cancels the stored pass without publishing a partial result', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers\nA = array shape 8192 fill 2');
            expect(() => withDemandBudget(100, () => runtime.execute('Q = A 3 7 powmod')))
                .toThrow(DemandBudgetExhausted);
            expect(runtime.variables.has('Q')).toBe(false);
            expect(runtime.execute('(A 3 7 powmod) sum')).toBe(8192n);
        } finally { runtime.dispose(); }
    });

    it('matches BigInt for mixed moduli, wide integers and broadcast exponents', () => {
        const runtime = new Interpreter();
        const bases = [1073643523n, 1073250360n, -135707530n, 2n ** 53n + 1n, 2n ** 100n + 3n];
        const moduli = [1073676290n, 1073283121n, 135707531n, 2n ** 30n + 1n, 2n ** 53n - 1n];
        const exponents = [0n, 2n, 2n ** 32n, 2n ** 53n + 1n];
        runtime.variables.set('A', ownedArray(bases, [5, 1]));
        runtime.variables.set('M', ownedArray(moduli, [5, 1]));
        runtime.variables.set('E', ownedArray(exponents, [4]));
        try {
            const result = runtime.execute('use numbers\nA E M powmod') as RankArray;
            expect(result.shape).toEqual([5, 4]);
            expect(result.items).toEqual(bases.flatMap((base, i) =>
                exponents.map(exponent => modularPower(base, exponent, moduli[i]))));
        } finally { runtime.dispose(); }
    });

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
            runtime.execute('use numbers\nA = array 2 3');
            expect(() => runtime.execute('Q = ' + expression)).toThrow(message);
            runtime.execute("Q' = " + expression);
            expect(runtime.execute('Q 0')).toBeGreaterThanOrEqual(0n);
            expect(() => runtime.execute('Q 1')).toThrow(message);
        } finally { runtime.dispose(); }
    });

    it('does not speculate deferred host cells and retains an ordinary result', () => {
        const runtime = new Interpreter();
        const reads: number[] = [];
        runtime.variables.set('Host', { kind: 'array', shape: [2], items: [],
            itemAt(index) { reads.push(index); return BigInt(index + 2); } });
        try {
            runtime.execute("use numbers\nQ' = Host 2 7 powmod");
            expect(reads).toEqual([]);
            expect(runtime.execute('Q 1')).toBe(2n);
            expect(reads).toEqual([1]);
            expect(runtime.execute('Q 1')).toBe(2n);
            expect(reads).toEqual([1, 1]);
            runtime.execute('A = array 2 3\nB = A 2 7 powmod');
            expect(runtime.execute('B 0')).toBe(4n);
            (runtime.variables.get('A') as RankArray).items[0] = 4n;
            expect(runtime.execute('B 0')).toBe(4n);
            expect(runtime.execute('(A 2 7 powmod) 0')).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('retains value semantics across language writes and rejects implicit sequences', () => {
        expect(execute('A = array 2 3\nQ = A 2 7 powmod\nA 0 = 4\nQ')).toEqual({ shape: [2], items: [4n, 2n] });
        expect(() => execute('(1 to 3) 2 7 powmod')).toThrow('expected integer input');
    });
});
