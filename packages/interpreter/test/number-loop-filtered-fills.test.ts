import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(source: string, options: InterpreterOptions = {}) {
    const r = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options }), d = new RuntimeDiagnostics();
    let error: string | undefined, result: string | undefined;
    try {
        try { const value = d.run(() => r.execute(source)); if (value !== undefined) result = formatValue(value); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, state: { result, error, variables: [...r.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, loops?: number) {
    const a = run(source);
    expect(a.state).toEqual(run(source, { compilation: false }).state);
    expect(a.state).toEqual(run(source, { numberLoopCompilation: false }).state);
    if (loops !== undefined) expect(a.d.numberLoops).toBe(loops);
    return a;
}
it.each([
    ['array -1 0 2 99', 'array false true true false'],
    ['array 0 0 2 3', 'array true true true true'],
    ['array -1 9 99', 'array false false false'],
    ['array shape 0 fill 0', 'array shape 0 fill false'],
    ['(array 0 1 2 3) reshape 2 2', '(array true false false true) reshape 2 2'],
].flatMap(([keys, mask]) => [false, true].map(boolean => ({ keys, mask, boolean }))))(
    'streams filtered fills $keys / $mask / $boolean', ({ keys, mask, boolean }) => {
        const fill = boolean ? 'false' : '3';
        const a = compare(`use sequences
Target = array shape 4 fill ${boolean ? 'true' : '0'}
Alias = Target
Keys = ${keys}
Gate = ${mask}
for Turn in 1 to 2
 Target (Keys Gate) = ${fill}
end`, 1);
        expect(a.state.error).toBeUndefined(); expect(a.state.result).toBe(fill);
    });
it('streams a numeric predicate without completing selected keys', () => {
    expect(compare(`use sequences
Target = array shape 8 fill false
Keys = (1 to 8) reshape 2 2 2
for Turn in 1 to 2
 Target (Keys (Keys less 8)) = true
end`, 1).state.error).toBeUndefined();
});
it.each([
    ['array 0 9', 'array true true'],
    ['array 0 -1', 'array true true'],
    ['array 0 1 2', 'array true false'],
])('retains selected-index/shape errors: %s / %s', (keys, gate) => {
    expect(compare(`Target = array shape 4 fill 0
Keys = ${keys}
Gate = ${gate}
for Turn in 1 to 2
 Target 0 = 7
 Target (Keys Gate) = 3
end`).state.error).toBeDefined();
});
it('does not demand an unselected wide index', () => {
    expect(compare(`Target = array shape 4 fill false
Keys = array 9007199254740993 0 2
Gate = array false true true
for Turn in 1 to 2
 Target (Keys Gate) = true
end`).state.error).toBeUndefined();
});
it('retains target/selector aliases', () => {
    expect(compare(`Target = array 3 2 1 0
Alias = Target
Gate = array false true true false
for Turn in 1 to 2
 Target (Target Gate) = 7
end`).state.error).toBeDefined();
});
it('leaves compound and array RHS behavior on the existing path', () => {
    for (const statement of ['Target (Keys Gate) += 3', 'Target (Keys Gate) = array 8 9']) {
        expect(compare(`Target = array shape 4 fill 0
Keys = array 0 1 2
Gate = array true false true
for Turn in 1 to 2
 ${statement}
end`).state.error).toBeUndefined();
    }
});
it('rechecks demand budgets after warming an external-target helper', () => {
    const r = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        r.execute(`fun Target mark Keys
 for Turn in 1 to 2
  Target (Keys Gate) = 3
 end
 return Target
end
Gate = array true false true false
Keys = array 0 1 2 3
Input = array shape 4 fill 0`);
        const warm = new RuntimeDiagnostics();
        expect(formatValue(warm.run(() => r.execute('Input mark Keys'))!)).toBe('3 0 3 0');
        expect(warm.numberLoops).toBe(1);
        const d = new RuntimeDiagnostics();
        expect(formatValue(withDemandBudget(100000, () => d.run(() => r.execute('Input mark Keys')))!)).toBe('3 0 3 0');
        expect(d.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => r.execute('Input mark Keys'))).toThrow('demand budget exhausted');
    } finally { r.dispose(); }
});
