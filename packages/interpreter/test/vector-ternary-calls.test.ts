import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';
import { denseScalarItems } from '../src/array-storage.js';
import { withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';

function execute(source: string, compilation = true, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation });
    const diagnostics = new RuntimeDiagnostics();
    runtime.variables.set('Nan', NaN);
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value),
                isRankArray(value) ? Array.from(denseScalarItems(value) ?? []).map(cell => Object.is(cell, -0)) : Object.is(value, -0)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source);
    expect(result.observation).toEqual(execute(source, false).observation);
    expect(result.observation).toEqual(execute(source, true, false).observation);
    return result;
}
function loop(expression: string, setup = 'A = -2 to 3 copy\nB = 7 to 12 copy') {
    return `use numbers\nuse sequences\n${setup}\nResult = A\nCount = 2\nfor Count greater 0\n Result = ${expression}\n Count -= 1\nend\nResult`;
}

describe('private ternary numeric vectors', () => {
    it.each([
        'A 5 13 powmod', 'A (A + 3) 13 powmod',
        'A 0 (B + 1) powmod', '(A greater 0) choose A B',
        'A less 0 choose (A * -3) (B mod 4)',
        'true choose (A + B) (A - B)',
        'A greater 0 choose 8 (B + 1)',
        '(A 5 13 powmod) greater 5 choose A B',
    ])('compiles %s', expression => {
        const result = compare(loop(expression));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each([
        'A greater 0 choose A B', 'A 5 (B + 13) powmod',
        'A greater 0 choose B (A + 4)',
    ])('broadcasts all three inputs in %s', expression => {
        const result = compare(loop(expression, 'A = (array -2 3) reshape 2 1\nB = (array 5 7 11) reshape 1 3'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('broadcasts a scalar mask against both differently shaped branches', () => {
        const result = compare(loop('true choose A B', 'A = (array -2 3) reshape 2 1\nB = (array 5 7 11) reshape 1 3'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('retains real cells, NaN and signed zero', () => {
        const result = compare(loop('A greater 0 choose B (B * -1.0)', 'A = array -1 0 1\nB = array -0.0 (Nan) 1.5').replace('Result = A', 'Result = B'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('replays an incompatible established array-element contract at its assignment', () => {
        compare(loop('true choose B B', 'A = array 1 2 3\nB = array 1.0 2.0 3.0'));
    });
    it.each([
        'A -1 13 powmod', 'A 5 0 powmod', 'A 5 -13 powmod',
        'true choose A (B // 0)',
        'A greater 0 choose (B // 0) (A // 0)',
        'A greater 0 choose A (1 to 4 copy)',
        'A (B - 10) 13 powmod',
        '(A * 9007199254740991) 5 13 powmod',
    ])('replays the original errors/precision in %s', expression => {
        compare(loop(expression));
    });
    it.each(['A 5 13 powmod', 'A -1 13 powmod', 'true choose A (B // 0)',
        'A greater 0 choose A B'])('retains empty-array demand for %s', expression => {
        compare(loop(expression, 'A = array shape 0 fill 1\nB = array shape 1 fill 7'));
    });
    it('copies an expression while retaining aliased snapshots across stores', () => {
        const result = compare(`use sequences
A = 1 to 4 copy
Saved = A
Result = A
Copy = A
Count = 2
for Count greater 0
 Copy = (A + 7) copy
 A 0 = 12
 Result = Copy + A
 Count -= 1
end
tuple Result Saved Copy A`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each(['choose', 'powmod', 'copy'])('checks rebound %s', word => {
        const definition = word === 'copy' ? 'fun X copy\n return X + 5\nend\n'
            : `fun A B C ${word}\n return A + B + C\nend\n`;
        compare(definition + loop(word === 'copy' ? '(A + 1) copy'
            : word === 'choose' ? 'true choose A B' : 'A 5 13 powmod'));
    });
    it('retains observable budget interruption and permits a later fast invocation', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute('use numbers\nuse sequences\nA = 1 to 1000 copy');
            const source = 'Count = 2\nfor Count greater 0\n Result = A 5 13 powmod\n Count -= 1\nend';
            expect(() => withDemandBudget(1, () => runtime.execute(source)))
                .toThrow(DemandBudgetExhausted);
            const diagnostics = new RuntimeDiagnostics();
            diagnostics.run(() => runtime.execute(source));
            expect(diagnostics.numberLoops).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });
});
