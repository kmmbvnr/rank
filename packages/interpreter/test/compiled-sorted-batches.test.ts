import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
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
it.each(['lowerindex', 'upperindex'])('compiles %s batches with forward, backward and repeated targets', operation => {
    const result = compare(`use algo
use sequences
Source = array -2.5 0.0 1.5 1.5 4.5
Targets = array 9.0 1.5 1.5 0.0 -9.0 4.5
Result = Targets integer
for I in 1 to 3
 Queries = Targets + I / 4.0
 Result = Source ${operation} Queries
end
Result`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['lowerindex', 'upperindex'])('retains %s tensor query shapes and can feed a gather', operation => {
    const result = compare(`use algo
use sequences
Source = array 1 2 2 5
Targets = (array 0 1 2 3 4 8) reshape 2 3
Result = Targets
for I in 1 to 3
 Positions = Source ${operation} Targets
 Result = Source (Positions min 3)
end
Result`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['array shape 0 fill 0', 'array 1', 'array 9007199254740993 9007199254740995'])('preserves empty, singleton and wide sources: %s', source => {
    compare(`use algo
Source = ${source}
Targets = array 0 1 2 9007199254740994
for I in 1 to 2
 Result = Source lowerindex Targets
end
Result`);
});
it('reads source writes before each batch and preserves earlier bindings', () => {
    const result = compare(`use algo
Source = array 0 2 4 6
Saved = Source
Targets = array 0 1 2 5 9
Result = Targets
for I in 1 to 3
 Source 0 = I
 Result = Source upperindex Targets
end
tuple Result Saved Source`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('replays a later error with ordinary write publication', () => {
    compare(`use algo
Source = array 0 2 4 6
Targets = array 0 1 2
for I in 1 to 3
 Result = Source upperindex Targets
 Source 0 = I
 Value = 1 // (2 - I)
end`);
});
it('retains budgeted search boundaries', () => {
    compare(`use algo
Source = array 0 2 4 6
Targets = array 0 1 2
for I in 1 to 3
 Result = Source upperindex Targets
end`, 100);
});
it('keeps late NaN target errors lazy on exact replay', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Source', typedArray(Float64Array.of(1, 2, 3)));
            runtime.variables.set('Targets', typedArray(Float64Array.of(0, NaN)));
            expect(() => runtime.execute('use algo\nfor I in 1 to 2\n Result = Source lowerindex Targets\nend')).toThrow('NaN');
        } finally { runtime.dispose(); }
    }
});
