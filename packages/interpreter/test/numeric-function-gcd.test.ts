import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, withDemandBudget } from '../src/index.js';

function run(source: string, compilation = true, budget?: number) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const execute = () => runtime.execute('use numbers\nuse sequences\n' + source);
        const value = diagnostics.run(() => budget === undefined ? execute() : withDemandBudget(budget, execute));
        return { result: { value: formatValue(value!) }, diagnostics };
    } catch (error) {
        return { result: { error: error instanceof RankError ? error.format() : String(error) }, diagnostics };
    } finally { runtime.dispose(); }
}
const ranked = `fun A leaf B
 return A gcd B
end
fun A score B rank 0 0
 G = A leaf B
 return G * G + B
end
A = array -12 0 18 24
Totals = 30 score A
Totals sum`;

it('prepares a private ranked non-leaf gcd function', () => {
    const actual = run(ranked);
    expect(actual.result).toEqual(run(ranked, false).result);
    expect(actual.result.error).toBeUndefined();
    expect(actual.diagnostics.numberFunctions).toBeGreaterThan(0);
    expect(actual.diagnostics.rankedBatches).toBeGreaterThan(0);
});
it.each(['array -9007199254740991 18', 'array 9007199254740993 18', 'array shape 0 fill 0'])
('retains exact integer results for %s', input => {
    const source = ranked.replace('array -12 0 18 24', input).replace('G * G + B', 'G * B + B');
    expect(run(source).result).toEqual(run(source, false).result);
});
it.each([1, 30, 100])('retains the compiled baseline budget boundary at %s', budget => {
    // Budget units differ between engines; these are the pre-change compiled
    // outcomes, not a demand for identical interpreter instruction counts.
    expect(run(ranked, true, budget).result).toEqual(budget === 1
        ? { error: 'Error: demand budget exhausted' } : { value: '1038' });
});
it('keeps an unselected error undemanded and a later demand attributed', () => {
    const source = ranked.replace('return G * G + B', 'return G // B').replace('Totals =', "Totals' =").replace('Totals sum', 'Totals 0');
    expect(run(source).result).toEqual(run(source, false).result);
    expect(run(source).result.error).toBeUndefined();
    expect(run(source.replace('Totals 0', 'Totals sum')).result)
        .toEqual(run(source.replace('Totals 0', 'Totals sum'), false).result);
});
it('retains source and closure snapshots across demands', () => {
    const source = ranked.replace('Totals sum', `First = Totals sum
A 0 = 7
First + Totals sum`);
    expect(run(source).result).toEqual(run(source, false).result);
});
it('allows captured scalar domains to change between ordinary calls', () => {
    const source = `Factor = 2
fun X leaf = X * Factor
fun X outer = X leaf + 1
First = 3 outer
Factor = 3
First + 3 outer`;
    expect(run(source).result).toEqual(run(source, false).result);
});

it.each(['max', 'min'])('compiles array %s before scalar-extrema inference', op => {
    const source = `E = array 1 2 3
Total = 0
for E ${op} greater 0
 Total += E sum
 E = E // 2 copy
end
Total`;
    const actual = run(source);
    expect(actual.result).toEqual(run(source, false).result);
    expect(actual.diagnostics.numberLoops).toBeGreaterThan(0);
    expect(actual.diagnostics.fallbacks['number-loop:binding-contract'] ?? 0).toBe(0);
});
it.each(['array shape 0 fill 1', 'array -1 0 1', 'array 9007199254740993 0'])
('preserves array max edge behavior for %s', input => {
    const source = `E = ${input}
Total = 0
for K in 1 to 2
 Total += E max
end
Total`;
    expect(run(source).result).toEqual(run(source, false).result);
});
it.each([1, 20, 100])('keeps array-extrema observable work at budget %s', budget => {
    const source = `E = array 1 2 3
Total = 0
for E max greater 0
 Total += E sum
 E = E // 2 copy
end
Total`;
    expect(run(source, true, budget).result).toEqual(run(source, false, budget).result);
});
it('keeps observable function hooks on the checked ranked path', () => {
    let entries = 0;
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => entries++ });
    try {
        const value = diagnostics.run(() => runtime.execute('use numbers\nuse sequences\n' + ranked));
        expect(value).toBe(1038n);
        expect(entries).toBeGreaterThan(0);
        expect(diagnostics.rankedBatches).toBe(0);
    } finally { runtime.dispose(); }
});
it('rechecks linked entries after a normal call and guarded execution', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(`use numbers
fun A leaf B = A gcd B
fun A score B
 return A leaf B + 1
end`);
        expect(runtime.execute('30 score 18')).toBe(7n);
        expect(() => withDemandBudget(1, () => runtime.execute('30 score 18'))).toThrow();
        expect(runtime.execute('30 score 18')).toBe(7n);
    } finally { runtime.dispose(); }
});
