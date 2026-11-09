import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const helper = `use sequences
fun Value quotient_sum Count
 Divisors = 1 to Count
 Half = Value // Divisors sum
 Total = 2 * Half - Count * Count
 return Total
end`;
function run(source: string, options: InterpreterOptions = {}, budget?: number) {
    const runtime = new Interpreter(() => {}, options), diagnostics = new RuntimeDiagnostics();
    try {
        let result: string | undefined, error: string | undefined;
        try {
            const execute = () => diagnostics.run(() => runtime.execute(source));
            const value = budget === undefined ? execute() : withDemandBudget(budget, execute);
            if (value !== undefined) result = formatValue(value);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { diagnostics, state: { result, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, budget?: number) {
    const actual = run(source, {}, budget);
    expect(actual.state).toEqual(run(source, { compilation: false }, budget).state);
    expect(actual.state).toEqual(run(source, { numberLoopCompilation: false }, budget).state);
    return actual;
}
it.each([1000n, -1000n, 1000000000000000n, -1000000000000000n,
    4503599627370496n, 9007199254740991n, 9007199254740992n, 1n << 80n])(
    'fuses a completed range and a scalar quotient sum for %s', value => {
        const result = compare(`${helper}
Answer = ${value} quotient_sum 8192`);
        expect(result.state.error).toBeUndefined();
        if (value <= 9007199254740991n && value >= -9007199254740991n) {
            expect(result.diagnostics.compiledArrayFunctions + result.diagnostics.numberLoops).toBeGreaterThan(0);
            expect(result.diagnostics.typedArrayPublishedCells).toBe(0);
        }
    });
it.each([1000000000000000n, -1000000000000000n])('keeps wide sums over descending negative divisors for %s', value => {
    const negative = helper.replace('1 to Count', '-1 to -Count by -1');
    const result = compare(`${negative}\nAnswer = ${value} quotient_sum 8192`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
});
it('keeps nested scalar calls correct when ranked over varying values', () => {
    const result = compare(`${helper}
fun Value terms
 return Value quotient_sum 127
end
Values = array 0 1000 1000000000000000
Answer = Values terms rank 0`);
    expect(result.state.error).toBeUndefined();

});
it.each([0, -2])('keeps an empty range at Count=%s', count => {
    expect(compare(`${helper}
Answer = 1000 quotient_sum ${count}`).state.error).toBeUndefined();
});
it.each(['Value // Divisors', '(Value * Divisors) // (Divisors - 4096)'])('preserves located division errors in %s', expression => {
    const source = helper.replace('1 to Count', '-4096 till Count').replace('Value // Divisors sum', `${expression} sum`);
    expect(compare(`${source}
Answer = 1000000000000000 quotient_sum 8192`).state.error).toContain('division by zero');
});
it.each([0, 5, 100, 1000])('retains ordinary completion work under budget %s', budget => {
    compare(`${helper}
Warm = 1000 quotient_sum 3
Answer = 1000000000000000 quotient_sum 8192`, budget);
});
it('preserves array snapshots when aliases need ordinary execution', () => {
    const result = compare(`use sequences
fun Count total
 Values = array shape Count fill 3
 Saved = Values
 Values (0 till Count by 2) += 5
 First = Values sum
 Second = Saved sum
 Total = First + Second
 return Total
end
Answer = 8192 total`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(0);
});
it('preserves warm cancellation and later ordinary calls', () => {
    const states: unknown[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`${helper}
Warm = 1000 quotient_sum 3`);
            let error: string | undefined;
            try { withInterrupt(new Int32Array([1]), () => runtime.execute('Answer = 1000000000000000 quotient_sum 8192')); }
            catch (e) { error = e instanceof RankError ? e.format() : String(e); }
            expect(error).toContain('RankError [Interrupted]');
            states.push({ error: error?.replace(/^RankError \[Interrupted\]:[^\n]*/, 'Interrupted'),
                published: runtime.variables.has('Answer') });
            expect(runtime.execute('1000 quotient_sum 31')).toBe(7069n);
        } finally { runtime.dispose(); }
    }
    expect(states[1]).toEqual(states[0]);
});
