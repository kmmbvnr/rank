import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, withDemandBudget } from '../src/index.js';

function helper(expression: string) {
    return `fun N fold\n Total = 0\n for J in 1 to 2\n  Total += ${expression}\n end\n return Total\nend`;
}
function execute(source: string, compilation = true, budget?: number) {
    const diagnostics = new RuntimeDiagnostics(), kernels: string[] = [];
    const run = new Interpreter(() => {}, { compilation, onIntegerLoopCompiled: code => kernels.push(code) });
    try {
        const evaluate = () => diagnostics.run(() => run.execute(source));
        const value = budget === undefined ? evaluate() : withDemandBudget(budget, evaluate);
        return { observation: { value: value === undefined ? undefined : formatValue(value) }, diagnostics, kernels };
    } catch (error) {
        return { observation: { error: error instanceof RankError ? error.format() : String(error) }, diagnostics, kernels };
    } finally { run.dispose(); }
}
function compare(source: string, budget?: number) {
    const actual = execute(source, true, budget);
    expect(actual.observation).toEqual(execute(source, false, budget).observation);
    return actual;
}

describe('consumed reciprocal range folds', () => {
    it('generates a checked progression in the consumer without allocating cells', () => {
        const result = compare(`${helper('N // (1 to 100) sum')}\n1000 fold`);
        expect(result.observation.value).toBe('10284');
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.typedArrayPublications).toBe(0);
        expect(result.kernels.some(code => code.includes('rangeCell'))).toBe(true);
        expect(result.kernels.every(code => !code.includes('rangeArray('))).toBe(true);
    });

    for (const range of ['1 to 9', '9 to 1 by -2', '-4 till 5 by 3', '1 to 0', '1 till 1',
        '0 to 0', '-1 to 1', '1 to 9 by 0', '1 to 9 by -1',
        '9007199254740989 to 9007199254740991', '9007199254740991 to 9007199254740993']) {
        it(`preserves exact results and errors for ${range}`, () => {
            for (const numerator of ['0', '17', '-17', '9007199254740991', '9007199254740993']) {
                compare(`${helper(`N // (${range}) sum`)}\n${numerator} fold`);
            }
        });
    }

    it('restarts exact arithmetic when the partial sum exceeds Number precision', () => {
        const result = compare(`${helper('N // (1 to 4) sum')}\n9007199254740991 fold`);
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('keeps singleton broadcasting and repeated calls independent', () => {
        const source = helper('(N // (1 to 4) + 1) sum');
        const result = compare(`${source}\nA = 12 fold\nB = 24 fold\narray A B (12 fold)`);
        expect(result.observation.value).toBe('58 108 58');
    });

    it('retains zip-to-shortest semantics for two sequences', () => {
        const result = compare(`${helper('(N // (1 to 4) + (1 to 1)) sum')}\n12 fold`);
        expect(result.observation.value).toBe('26');
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it('retains sequence zip and multidimensional array semantics', () => {
        expect(compare(`${helper('(N // (1 to 4) + (1 to 3)) sum')}\n12 fold`).observation.value).toBe('56');
        expect(compare(`${helper('(N // (1 to 3) + (array shape 2 3 fill 1)) sum')}\n12 fold`).observation.value).toBe('100');
    });

    it('keeps analytic bare, affine and scalar-bound range sums bounded', () => {
        for (const expression of ['(1 to N) sum', '(3 * (1 to N) + 2) sum', '(1 to (N // 2)) sum']) {
            const small = compare(`${helper(expression)}\n100 fold`);
            expect(small.observation.error).toBeUndefined();
            expect(small.diagnostics.numberLoops).toBe(0);
            const bounded = compare(`${helper(expression)}\n1000000000000 fold`, 1000);
            expect(bounded.diagnostics.numberLoops).toBe(0);
        }
    });

    it('does not force an unused deferred range fold', () => {
        const result = compare(`fun N ignore\n Bad' = N // (0 to 2) sum\n for J in 1 to 2\n  X = J\n end\n return 7\nend\n10 ignore`);
        expect(result.observation.value).toBe('7');
    });

    it('retains an ordinary binding before later reassignment', () => {
        const result = compare(`fun N snapshot\n Saved = N\n Total = 0\n for J in 1 to 2\n  Total += Saved // (1 to 4) sum\n  N = 999\n end\n return Total\nend\n12 snapshot`);
        expect(result.observation.value).toBe('50');
    });

    it('preserves the first failing scalar operand on empty progressions', () => {
        compare(`${helper('((1 // 0) // (1 to 0)) sum')}\n1 fold`);
    });

    it('honors bounded observation of a long private fold', () => {
        const result = compare(`${helper('N // (1 to N) sum')}\n1000000000 fold`, 100);
        expect(result.observation.error).toContain('demand budget exhausted');
    });
});
