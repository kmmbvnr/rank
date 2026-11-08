import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

const expand = `fun Counts expand
 Ends = Counts scan +
 Starts = Ends - Counts
 Total = Counts sum
 Mark = array shape Total fill 0
 Mark Starts = 1
 Owner = (Mark scan +) - 1
 Offset = (0 till Total) - Starts Owner
 return tuple Owner Offset
end`;
function run(source: string, options: InterpreterOptions = {}) {
    const output: string[] = [], r = new Interpreter(text => output.push(text), { scalarEntryCompilation: false, ...options }), d = new RuntimeDiagnostics();
    let result: string | undefined, error: string | undefined;
    try {
        try { const value = d.run(() => r.execute(source)); if (value !== undefined) result = formatValue(value); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, state: { result, error, output, variables: [...r.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, loops?: number) {
    const a = run(source);
    expect(a.state).toEqual(run(source, { compilation: false }).state);
    expect(a.state).toEqual(run(source, { numberLoopCompilation: false }).state);
    if (loops !== undefined) expect(a.d.numberLoops).toBe(loops);
    return a;
}
it.each(['array 3 2 4', 'array 1', 'array 1 1 1', 'array 0 3 2', 'array shape 0 fill 0'])(
    'compiles a straight-line expansion of %s', input => {
        expect(compare(`use sequences\n${expand}\nInput = ${input}\nResult = Input expand`, 1).state.error).toBeUndefined();
    });
it.each(['+ 1', '* 3', '// 2', 'mod 5'])('completes a nested prefix before %s', operation => {
    const a = compare(`use sequences
A = array 2 3 5 7
for I in 1 to 2
 B = (A scan +) ${operation}
end`, 1);
    expect(a.state.error).toBeUndefined();
});
it.each(['+', '*'])('composes modular scan %s with a following point map', op => {
    expect(compare(`use sequences
A = (1 to 12) reshape 2 3 2
for I in 1 to 2
 B = ((A scan ${op} axis 1 with I) mod 17) + I
end`, 1).state.error).toBeUndefined();
});
it.each(['array 9007199254740992 1', 'array -3 1', 'array 2 -1 2'])(
    'retains errors or exact replay for %s', input => {
        compare(`use sequences\n${expand}\nInput = ${input}\nResult = Input expand`);
    });
it('keeps unused deferred bindings uncomputed', () => {
    expect(compare(`fun Count filled
 Deferred' = 1 // 0
 Values = array shape Count fill 0
 Values 0 = 7
 return Values
end
Result = 3 filled`).state.error).toBeUndefined();
});
it('leaves external writes on their existing function path', () => {
    expect(compare(`fun Values alter
 Values 0 += 1
 return Values
end
Input = array 2 3
Alias = Input
Result = Input alter`).state.error).toBeUndefined();
});
it('retains side effects and error order around writes', () => {
    const result = compare(`use io
fun Count filled
 Values = array shape Count fill 0
 11 print
 Values 0 = 7
 13 print
 Values 1 = 1 // 0
 return Values
end
Result = 3 filled`);
    expect(result.state.output).toEqual(['11', '13']);
    expect(result.state.error).toContain('division by zero');
});
it('keeps warm straight-line helpers on the ordinary path under budgets', () => {
    const r = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        r.execute(`use sequences\n${expand}\nInput = array 3 2 4`);
        const warm = new RuntimeDiagnostics();
        const expected = formatValue(warm.run(() => r.execute('Input expand'))!);
        expect(warm.numberLoops).toBe(1);
        const d = new RuntimeDiagnostics();
        expect(formatValue(withDemandBudget(100000, () => d.run(() => r.execute('Input expand')))!)).toBe(expected);
        expect(d.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => r.execute('Input expand'))).toThrow('demand budget exhausted');
    } finally { r.dispose(); }
});
