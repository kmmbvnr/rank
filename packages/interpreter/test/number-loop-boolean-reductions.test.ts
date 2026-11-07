import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(source: string, options: object = {}) {
    const runtime = new Interpreter(() => {}, { ...options, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const actual = run(source);
    expect(actual.observation).toEqual(run(source, { compilation: false }).observation);
    expect(actual.observation).toEqual(run(source, { numberLoopCompilation: false }).observation);
    return actual;
}

it.each(['any', 'all'])('compiles %s in vector loop headers', operation => {
    const predicate = operation === 'any' ? 'Values greater 0 any' : 'Values greater 0 all';
    const result = compare(`use sequences
Values = array 3 4 5
Saved = Values
Count = 0
for ${predicate}
 Values -= 1
 Count += 1
end
tuple Values Saved Count`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['any', 'all'])('retains %s on stored masks and compiles broadcast predicates', operation => {
    for (const input of ['array true false true', 'array shape 0 fill false',
        'array shape 2 0 3 fill false', '(array true false) reshape 1 2']) {
        const result = compare(`use sequences
Mask = ${input}
Count = 2
Result = false
for Count greater 0
 Result = not (not Mask) ${operation}
 Count -= 1
end
Result`);
        expect(result.observation.error).toBeUndefined();
    }
    const result = compare(`use sequences
Values = (array 1 2) reshape 2 1
Offsets = array 0 2 4
Count = 2
Result = false
for Count greater 0
 Result = not (Values + Offsets at most 2) ${operation}
 Count -= 1
end
Result`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['any', 'all'])('keeps unchanged packed %s inputs on the native path', operation => {
    const result = compare(`use sequences
Mask = array shape 100000 fill true
Count = 10
Result = false
for Count greater 0
 Result = Mask ${operation}
 Count -= 1
end
Result`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(0);
});
it.each(['any', 'all'])('publishes the empty identity of private %s stages', operation => {
    const result = compare(`use sequences
Values = array 1 2 3
Result = false
for I in 0 to 1
 Mask = Values greater 0
 Result = Mask ${operation}
 Values = Values (Values less 0)
end
Result`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
    expect(result.observation.variables.find(([name]) => name === 'Result')?.[1]).toBe(String(operation === 'all'));
});
it.each(['any', 'all'])('retains unused late array errors when %s short-circuits', operation => {
    const result = compare(`use sequences
Values = array 1 0
Divisors = array 1 0
Count = 2
Result = false
for Count greater 0
 Result = Values // Divisors ${operation === 'any' ? 'greater' : 'less'} 0 ${operation}
 Count -= 1
end`);
    expect(result.observation.error).toBeUndefined();
    const demanded = compare(`use sequences
Values = array 1 0
Divisors = array 1 0
Count = 2
Result = false
for Count greater 0
 Result = Values // Divisors ${operation === 'any' ? 'less' : 'greater'} 0 ${operation}
 Count -= 1
end`);
    expect(demanded.observation.error).toContain('zero');
});
it.each(['any', 'all'])('replays wide predicates and keeps ordinary snapshots for %s', operation => {
    const result = compare(`use sequences
Values = array 9007199254740991 2
Saved = Values
Count = 2
Result = false
for Count greater 0
 Result = Values * 2 greater 0 ${operation}
 Values += 1
 Count -= 1
end
tuple Values Saved Result`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});
it.each(['any', 'all'])('retains lazy, scalar and shadowed %s semantics', operation => {
    for (const setup of ['Values\' = (array 1 0) // (array 1 0)', 'Values = 1']) {
        compare(`use sequences
${setup}
Count = 2
for Count greater 0
 Result = Values greater 0 ${operation}
 Count -= 1
end`);
    }
    const result = compare(`fun Values ${operation}
 return false
end
Values = array 1 0
Count = 2
for Count greater 0
 Result = Values ${operation}
 Count -= 1
end`);
    expect(result.observation.error).toBeUndefined();
});
it('retains demand budget interruption rather than taking the private reduction', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute('use sequences\nValues = array shape 10000 fill 1\nCount = 2');
        expect(() => withDemandBudget(1, () => runtime.execute('for Values greater 0 any\n Count -= 1\n Values -= 1\nend'))).toThrow();
        expect(runtime.variables.get('Count')).toBe(2n);
    } finally { runtime.dispose(); }
});
