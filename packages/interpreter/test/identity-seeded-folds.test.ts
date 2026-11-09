import { expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, parse, type RankValue } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

function run(operator: string, seed: string, values: RankValue, compilation: boolean, budget?: number) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { compilation, functionBodyCompilation: false, blockCompilation: false });
    runtime.variables.set('Input', values);
    runtime.execute(`use sequences\nfun Values folded\n return Values reduce ${operator} with ${seed}\nend`);
    try {
        let value: string | undefined, error: string | undefined;
        try {
            const execute = () => diagnostics.run(() => runtime.execute('Input folded'));
            const result = budget === undefined ? execute() : withDemandBudget(budget, execute);
            if (result !== undefined) value = formatValue(result);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { state: { value, error }, calls: diagnostics.compiledTensors };
    } finally { runtime.dispose(); }
}
it.each([['+', '0'], ['*', '1']])('admits %s with %s to the scalar compiler', (operator, seed) => {
    const statement = parse(`use sequences\nfun Values folded\n return Values reduce ${operator} with ${seed}\nend`).statements[1];
    if (!isFunctionStatement(statement)) throw Error('expected a function');
    expect(compileScalarFunction(statement, [{ kind: 'array', element: 'integer', rank: 1 }], true)).toBeDefined();
});
it.each([{ operator: '+', seed: '0' }, { operator: '*', seed: '1' }])(
    'compiles the exact $operator identity seed', ({ operator, seed }) => {
        for (const values of [[], [0], [1], [-3, 2, 7], [2147483647, 2147483647, 2147483647]]) {
            const input = typedArray(Int32Array.from(values));
            const result = run(operator, seed, input, true);
            expect(result.state).toEqual(run(operator, seed, input, false).state);
            expect(result.state.error).toBeUndefined();
            expect(result.calls).toBe(values.length ? 1 : 0);
        }
    });
it.each([
    ['+', '0.0'], ['*', '1.0'], ['+', '2'], ['*', '0'], ['*', '(-1)'],
])('keeps noninteger or nonidentity %s seed %s ordinary', (operator, seed) => {
    for (const values of [[], [1, -2, 3]]) {
        const input = typedArray(Int32Array.from(values));
        const result = run(operator, seed, input, true);
        expect(result.state).toEqual(run(operator, seed, input, false).state);
        expect(result.calls).toBe(0);
    }
});
it.each(['+', '*'])('preserves rank-two %s reduction shape', operator => {
    const input = typedArray(Int32Array.of(1, 2, 3, 4), [2, 2]);
    const seed = operator === '+' ? '0' : '1';
    expect(run(operator, seed, input, true).state).toEqual(run(operator, seed, input, false).state);
});
it.each([0, 1, 3, 20])('retains seeded fold demand charges at budget %s', budget => {
    const input = typedArray(new Int32Array(64).fill(3));
    for (const [operator, seed] of [['+', '0'], ['*', '1']]) {
        expect(run(operator, seed, input, true, budget).state).toEqual(run(operator, seed, input, false, budget).state);
    }
});
it('retains a later cancellation scope and ordinary reuse after warmup', () => {
    for (const [operator, seed] of [['+', '0'], ['*', '1']]) {
        const outcomes: unknown[] = [];
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.variables.set('Input', typedArray(new Int32Array(8192).fill(1)));
                runtime.execute(`use sequences\nfun Values folded\n return Values reduce ${operator} with ${seed}\nend\nWarm = Input folded`);
                let error: string | undefined;
                try { withInterrupt(new Int32Array([1]), () => runtime.execute('Answer = Input folded')); }
                catch (e) { error = e instanceof RankError ? e.format() : String(e); }
                // Native stored-array folds may finish before their next poll.
                // Compiled cell traversal may observe cancellation earlier.
                if (error) expect(error).toContain('Interrupted');
                outcomes.push(formatValue(runtime.execute('Input folded')!));
            } finally { runtime.dispose(); }
        }
        expect(outcomes[1]).toEqual(outcomes[0]);
    }
});
it('compiles a factor-derived product with an explicit empty identity', () => {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(`use numbers\nuse sequences\nfun N totient\n Factors = N factors unique array\n Divisor = Factors reduce * with 1\n Terms = Factors - 1\n Product = Terms reduce * with 1\n return N // Divisor * Product\nend`);
        expect(diagnostics.run(() => runtime.execute('1 totient'))).toBe(1n);
        expect(diagnostics.run(() => runtime.execute('12 totient'))).toBe(4n);
        expect(diagnostics.run(() => runtime.execute('997 totient'))).toBe(996n);
        expect(diagnostics.compiledTensors).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});
