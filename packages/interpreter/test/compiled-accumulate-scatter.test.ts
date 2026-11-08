import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(source: string, compilation = true, numberLoopCompilation = true, budget?: number) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined, result: string | undefined;
        const execute = () => { result = formatValue(runtime.execute(source)!); };
        try { diagnostics.run(() => budget === undefined ? execute() : withDemandBudget(budget, execute)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        const calls = runtime.variables.has('Calls') ? runtime.execute('Calls len') : undefined;
        return { diagnostics, observation: { error, result, calls,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, budget?: number) {
    const result = run(source, true, true, budget);
    expect(result.observation).toEqual(run(source, false, false, budget).observation);
    expect(result.observation).toEqual(run(source, true, false, budget).observation);
    return result;
}
it.each(['+=', '-=', '*='])('compiles duplicate accumulating %s with scalar and vector operands', operator => {
    for (const operand of ['2', 'Weights']) {
        const result = compare(`Values = array 2 3 4
Saved = Values
Keys = array 1 1 2 1
Weights = array 2 3 4 5
for I in 1 to 3
 Values Keys ${operator} ${operand} .accumulate
 Done = I
end
tuple Values Saved`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    }
});
it.each(['Values', 'Values Keys', 'Keys', '3'])('snapshots accumulating keys and RHS %s', operand => {
    const result = compare(`Values = array 1 0 1
Saved = Values
Keys = array 0 0 2
for I in 1 to 2
 Values Keys += ${operand} .accumulate
 Done = I
end
tuple Values Saved`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('snapshots selectors that share the destination storage', () => {
    const result = compare(`Values = array 1 0 1
Saved = Values
for I in 1 to 2
 Values Values += 1 .accumulate
end
tuple Values Saved`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['+=', '-=', '*='])('retains real rounding and signed zero for %s', operator => {
    const result = compare(`Values = array -0.0 0.1 0.3
Keys = array 0 1 1 2
Weights = array -0.0 0.2 0.3 0.1
for I in 1 to 2
 Values Keys ${operator} Weights .accumulate
 Done = I
end
Values`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('widens Int32 destinations while retaining earlier duplicate updates', () => {
    const result = compare(`Values = array 2147483647 1
Keys = array 0 0 1
for I in 1 to 2
 Values Keys += 1 .accumulate
end
Values`);
    expect(result.observation.result).toBe('2147483651 3');
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['+=', '-=', '*='])('replays wide accumulating %s without publishing private progress', operator => {
    const result = compare(`Values = array 9007199254740990 2
Saved = Values
Keys = array 0 1 0
for I in 1 to 2
 Values Keys ${operator} ${operator === '-=' ? '-2' : '2'} .accumulate
end
tuple Values Saved`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});
it.each(['array 0 9', 'array -1 0', 'array 0 1.5'])('validates all accumulating selectors before evaluating the RHS: %s', keys => {
    const result = compare(`Values = array 1 2
Keys = ${keys}
for I in 1 to 2
 Values Keys += 1 // 0 .accumulate
end`);
    expect(result.observation.error).toBeDefined();
});
it.each(['array 2 3', 'array true false true', '(array 2 3 4) reshape 1 3'])('retains accumulating RHS shape and type errors: %s', operand => {
    const result = compare(`use sequences
Values = array 1 2 3
Keys = array 0 0 1
Weights = ${operand}
for I in 1 to 2
 Values Keys += Weights .accumulate
 Done = I
end`);
    expect(result.observation.error).toBeDefined();
});
it('retains the scalar RHS as the assignment result', () => {
    const result = compare(`Values = array 1 2
Keys = array 0 0
for I in 1 to 2
 Values Keys += 3 .accumulate
end`);
    expect(result.observation.result).toBe('3');
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('retains budgeted read/write boundaries', () => {
    compare(`Values = array 1 2
Keys = array 0 0 1
for I in 1 to 2
 Values Keys += 2 .accumulate
end
Values`, 10);
});
it('validates all indices before a RHS call with visible effects', () => {
    const result = compare(`use algo
Values = array 1 2
Keys = array 0 9
Calls = new queue
fun Calls rhs
 Calls push 1
 return 3
end
for I in 1 to 2
 Values Keys += Calls rhs .accumulate
end`);
    expect(result.observation.error).toContain('bounds');
    expect(result.observation.calls).toBe(0n);
});

it.each(['+=', '-=', '*='])('streams arithmetic RHS for accumulating %s', operator => {
    const result = compare(`Values = array 2 3 4
Saved = Values
Keys = array 1 1 2 1
Weights = array 2 3 4 5
for I in 1 to 3
 Values Keys ${operator} (Weights * 3 + 1) mod 7 .accumulate
 Done = I
end
tuple Values Saved`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['Values Keys * 2', 'Values + 1', '(Values * Values) mod 7'])('snapshots streamed RHS aliases: %s', rhs => {
    const result = compare(`Values = array 1 2 3
Keys = array 0 0 1
for I in 1 to 2
 Values Keys += ${rhs} .accumulate
 Done = I
end
Values`);
    expect(result.observation.error).toBeUndefined();
});
it.each(['(Weights * 9007199254740991) mod 7', 'Weights // 0', 'Weights + (1 // 0)', 'Weights + (array 1 2)'])('replays streamed arithmetic errors or overflow: %s', rhs => {
    compare(`Values = array 2 3 4
Keys = array 0 0 2
Weights = array 2 3 4
for I in 1 to 2
 Values Keys += ${rhs} .accumulate
 Done = I
end
Values`);
});
it('validates all selectors before a scalar error inside a vector RHS', () => {
    const result = compare(`Values = array 2 3 4
Keys = array 0 0 9
Weights = array 2 3 4
for I in 1 to 2
 Values Keys += Weights + (1 // 0) .accumulate
 Done = I
end
Values`);
    expect(result.observation.error).toContain('bounds');
});

it.each(['Weights * 3 - 1', 'Weights // 2', 'Weights min 3', 'Weights max 3', 'Weights band 3', 'Weights isqrt'])('retains vector-expression optimizations for %s', rhs => {
    const result = compare(`use numbers
use bits
Values = array 2 3 4
Keys = array 0 0 2
Weights = array 2 3 4
for I in 1 to 2
 Values Keys += ${rhs} .accumulate
 Done = I
end
Values`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
