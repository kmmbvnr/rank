import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';
function run(source: string, compilation = true, numberLoopCompilation = true, budget?: number) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined, result: string | undefined;
        const execute = () => { result = formatValue(runtime.execute(source)!); };
        try { diagnostics.run(() => budget === undefined ? execute() : withDemandBudget(budget, execute)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error, result,
            values: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, budget?: number) {
    const result = run(source, true, true, budget);
    expect(result.observation).toEqual(run(source, false, false, budget).observation);
    expect(result.observation).toEqual(run(source, true, false, budget).observation);
    return result;
}
it.each(['=', '+=', '-=', '*='])('compiles numeric vector range %s with snapshot aliases', operator => {
    for (const real of [false, true]) {
        const result = compare(`Values = array ${real ? '1.0 2.0 3.0 4.0' : '1 2 3 4'}
Saved = Values
for I in 1 to 3
 Values (1 to 3) ${operator} Values (0 till 3) + ${real ? '0.5' : '1'}
 Done = I
end
tuple Values Saved`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
    }
});
it.each(['0 to 2', '3 to 1 by -1', '0 till 4 by 2', '3 till 3'])('preserves real scalar fill and empty selection: %s', selector => {
    const result = compare(`Values = array 1.0 2.0 3.0 4.0
for I in 1 to 2
 Values (${selector}) = 0.5
end
Values`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
});
it.each(['0 to 4', '0 to 2 by 0', '3 till 3', '3 to 1 by -1'])('retains selector and RHS error order: %s', selector => {
    const result = compare(`Values = array 1.0 2.0 3.0 4.0
for I in 1 to 2
 Values (${selector}) = (array 1.0 2.0) / 0.0
end`);
    expect(result.observation.error).toBeDefined();
});
it('widens integer range writes and replays unsafe values exactly', () => {
    compare(`Values = array 2147483647 9007199254740990 1
for I in 1 to 2
 Values (0 to 2) += Values + 1
 Done = I
end
Values`);
});
it('retains a fresh vector RHS as the loop result', () => {
    const result = compare(`Values = array 1.0 2.0 3.0
Weights = array 0.5 1.5
for I in 1 to 2
 Values (0 to 1) = Weights + 0.5
end`);
    expect(result.observation.error).toBeUndefined();
    expect(result.observation.result).toBe('1 2');
    expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
});
it('retains budgeted read/write boundaries', () => {
    compare(`Values = array 1.0 2.0 3.0
Weights = array 0.5 1.5
for I in 1 to 2
 Values (0 to 1) = Weights + 0.5
end`, 100);
});
