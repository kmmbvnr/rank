import { expect, it } from 'vitest';
import { withDemandBudget } from '../src/interrupt.js';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';

function run(source: string, options: InterpreterOptions = {}, named = false) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined, result: string | undefined;
    try {
        runtime.execute('A = array 2 4 6 8 10 12');
        if (named) Object.defineProperty(runtime.variables.get('A')!, 'columnNames', { value: ['a', 'b', 'c', 'd', 'e', 'f'] });
        try { const value = diagnostics.run(() => runtime.execute(source)); if (value !== undefined) result = formatValue(value); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { observation: { error, result, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) }, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string, loops?: number, named = false) {
    const result = run(source, {}, named);
    expect(result.observation).toEqual(run(source, { compilation: false }, named).observation);
    expect(result.observation).toEqual(run(source, { numberLoopCompilation: false }, named).observation);
    if (loops !== undefined) expect(result.diagnostics.numberLoops).toBe(loops);
    return result;
}
it.each(['0 to 4 by 2', '5 to 1 by -2', '1 till 5 by 2', '3 till 3', '5 to 1'])('compiles a named gather: %s', range => {
    const result = compare(`for I in 1 to 2
 Slots = ${range}
 Saved = A Slots
 A 0 = I
 Done = I
end`, 1);
    expect(result.observation.error).toBeUndefined();
});
it.each(['array 1.5 2.5 3.5 4.5 5.5 6.5', 'array true false true false true false'])('selects %s', values => {
    const result = compare(`B = ${values}
for I in 1 to 2
 Slots = 0 to 4 by 2
 Saved = B Slots
 Done = I
end`, 1);
    expect(result.observation.error).toBeUndefined();
});
it('captures bounds and completes selections before later writes', () => {
    expect(compare(`Start = 0
Last = 4
for I in 1 to 2
 Slots = Start to Last by 2
 Start = 1
 Last = 5
 Saved = A Slots
 A (0 to 5) = I
 Saved 0 = 99
 Done = I
end`, 1).observation.error).toBeUndefined();
});
it.each(['-1 to 2', '4 to 9', '1 to 4 by 0', '9007199254740992 to 9007199254740994'])('preserves named range errors: %s', range => {
    compare(`for I in 1 to 2
 Slots = ${range}
 Saved = A Slots
 Done = I
end`);
});
it.each(['=', '+=', '-=', '*=', '//='])('returns the completed operand of %s', operator => {
    const source = `Alias = A
for I in 1 to 2
 Slots = 0 to 4 by 2
 A Slots ${operator} A Slots + 2
end`;
    const result = compare(source, operator === '//=' ? 0 : 1);
    expect(result.observation.error).toBeUndefined();
    // The result is the RHS, not the target after a compound update.
    if (operator === '*=') expect(result.observation.result).toBe('10 50 122');
});
it.each(['A Slots + 9007199254740991', 'A (0 to 1) + 1', 'A Slots // 0'])('replays wide arithmetic or errors in %s', rhs => {
    compare(`for I in 1 to 2
 Slots = 0 to 4 by 2
 A Slots -= ${rhs}
end`);
});
it('keeps column metadata on the ordinary path', () => {
    compare(`for I in 1 to 2
 Slots = 0 to 4 by 2
 Saved = A Slots
 Done = I
end`, 0, true);
});

it('keeps a returned real operand stable after later writes', () => {
    const results = [{}, { compilation: false }, { numberLoopCompilation: false }].map(options => {
        const r = new Interpreter(() => {}, options), d = new RuntimeDiagnostics();
        try {
            r.execute('Values = array 1.5 2.5 3.5 4.5');
            const result = d.run(() => r.execute(`for I in 1 to 2
 Slots = 0 to 2 by 2
 Values Slots += Values Slots * 2.0
end`))!;
            if (!('compilation' in options) && !('numberLoopCompilation' in options)) expect(d.numberLoops).toBe(1);
            const before = formatValue(result);
            r.execute('Values (0 to 3) = 99.0');
            return [before, formatValue(result)];
        } finally { r.dispose(); }
    });
    expect(results).toEqual([['9 21', '9 21'], ['9 21', '9 21'], ['9 21', '9 21']]);
});
it('retains observable demand in a warmed named-range consumer', () => {
    const r = new Interpreter(() => {});
    try {
        r.execute(`fun Values selected Last
 Result = array shape 0 fill 0
 for Turn in 1 to 2
  Slots = 0 to Last by 2
  Result = Values Slots
 end
 return Result
end
Input = array 1 2 3 4 5 6`);
        const warm = new RuntimeDiagnostics();
        expect(formatValue(warm.run(() => r.execute('Input selected 4'))!)).toBe('1 3 5');
        expect(warm.numberLoops).toBe(1);
        const d = new RuntimeDiagnostics();
        expect(formatValue(withDemandBudget(100000, () => d.run(() => r.execute('Input selected 2')))!)).toBe('1 3');
        expect(d.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => r.execute('Input selected 4'))).toThrow('demand budget exhausted');
    } finally { r.dispose(); }
});
