import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(source: string, options: InterpreterOptions = {}, named = false) {
    const r = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options }), d = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        if (named) {
            r.execute('Input = array 1 2 3 4');
            Object.defineProperty(r.variables.get('Input')!, 'columnNames', { value: ['A', 'B', 'C', 'D'] });
        }
        try { d.run(() => r.execute(source)); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, state: { error, variables: [...r.variables].map(([name, value]) => [name,
            isRankArray(value) ? { shape: value.shape, items: [...value.items], columns: value.columnNames } : formatValue(value)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, loops?: number, named = false) {
    const a = run(source, {}, named);
    expect(a.state).toEqual(run(source, { compilation: false }, named).state);
    expect(a.state).toEqual(run(source, { numberLoopCompilation: false }, named).state);
    if (loops !== undefined) expect(a.d.numberLoops).toBe(loops);
    return a;
}
it.each(['6', '2 3', '2 1 3', '0 3', '2 0 3'].flatMap(shape => ['1', '1.5', 'true'].map(fill => ({ shape, fill }))))(
    'reverses the leading axis of $shape / $fill', ({ shape, fill }) => {
        expect(compare(`use sequences
Input = array shape ${shape} fill ${fill}
for I in 1 to 2
 Reversed = Input reverse
end`, 1).state.error).toBeUndefined();
    });
it('preserves row order, aliasing and ordinary completed bindings', () => {
    expect(compare(`use sequences
Input = (1 to 12) reshape 3 2 2
Alias = Input
Saved = Input
for I in 1 to 2
 Reversed = Input reverse
 if I equal 1
  Saved = Reversed
 end
 Input 0 0 0 = I
 Reversed 0 0 0 = 99
end`, 1).state.error).toBeUndefined();
});
it('preserves signed zeros and nonfinite real values', () => {
    expect(compare(`use numbers
use sequences
Input = array -0.0 0.0 infinity nan
for I in 1 to 2
 Reversed = Input reverse
end`).state.error).toBeUndefined();
});
it('retains exact wide integer storage', () => {
    expect(compare(`use sequences
Input = array 18446744073709551616 -1 0
for I in 1 to 2
 Reversed = Input reverse
end`).state.error).toBeUndefined();
});
it('retains source errors and earlier writes', () => {
    expect(compare(`use sequences
Input = array 1 0 2
Done = 0
for I in 1 to 2
 Done = I
 Reversed = (Input // Input) reverse
end`).state.error).toContain('division by zero');
});
it('keeps a shadowed reverse on its ordinary implementation', () => {
    expect(compare(`fun Values reverse
 return Values + 10
end
Input = array 1 2 3
for I in 1 to 2
 Reversed = Input reverse
end`).state.error).toBeUndefined();
});
it('keeps a range as a sequence until it completes', () => {
    expect(compare(`use sequences
for I in 1 to 2
 Reversed = (1 to 5) reverse copy
end`).state.error).toBeUndefined();
});
it('retains named columns on the ordinary path', () => {
    compare(`use sequences
for I in 1 to 2
 Reversed = Input reverse
end`, 0, true);
});
it('rechecks budgets for a warmed reverse function', () => {
    const r = new Interpreter(() => {});
    try {
        r.execute(`use sequences
fun Values backwards
 Result = Values
 for Turn in 1 to 2
  Result = Values reverse
 end
 return Result
end
Input = array 1 2 3 4`);
        const warm = new RuntimeDiagnostics();
        expect(formatValue(warm.run(() => r.execute('Input backwards'))!)).toBe('4 3 2 1');
        expect(warm.numberLoops).toBe(1);
        const d = new RuntimeDiagnostics();
        expect(formatValue(withDemandBudget(100000, () => d.run(() => r.execute('Input backwards')))!)).toBe('4 3 2 1');
        expect(d.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => r.execute('Input backwards'))).toThrow('demand budget exhausted');
    } finally { r.dispose(); }
});
