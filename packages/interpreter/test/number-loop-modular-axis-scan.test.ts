import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(source: string, compilation: boolean, budget?: number) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        const execute = () => diagnostics.run(() => runtime.execute(source));
        try { if (budget === undefined) execute(); else withDemandBudget(budget, execute); }
        catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
        return { diagnostics, state: { error, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const actual = run(source, true);
    expect(actual.state).toEqual(run(source, false).state);
    return actual;
}
it.each([
    ['2 3', '0'], ['2 3', '1'], ['2 3 4', '0'], ['2 3 4', '1'], ['2 3 4', '-1'],
    ['2 0 3', '1'], ['0 3', '1'], ['2 3 0', '0'], ['3', '0'],
])('compiles modular prefixes on shape %s axis %s', (shape, axis) => {
    const result = compare(`use sequences
A = array shape ${shape} fill 3
Total = 0
for I in 1 to 3
 B = (A scan + axis ${axis}) mod 17
 Total += B sum
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each([['2 3', '0'], ['2 3', '1'], ['2 0 3', '1'], ['2 0 3', '2']])(
    'grows only the seeded axis for shape %s axis %s', (shape, axis) => {
        const result = compare(`use sequences
A = array shape ${shape} fill 2
for I in 1 to 3
 B = (A scan + axis ${axis} with I) mod 17
end`);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
it('preserves retained results and pooled inputs across scans', () => {
    const result = compare(`use sequences
A = (1 to 12) reshape 2 3 2
Saved = array shape 2 3 2 fill 0
for I in 1 to 3
 B = ((A + I) scan + axis 1) mod 17
 if I equal 1
  Saved = B
 end
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['9007199254740991', '18446744073709551616'])('replays wide modular prefixes %s exactly', value => {
    expect(compare(`use sequences
A = array shape 2 3 fill ${value}
Total = 0
for I in 1 to 2
 B = (A scan + axis 0) mod 17
 Total += B sum
end`).state.error).toBeUndefined();
});
it.each(['2', '-3'])('preserves invalid axis %s and earlier writes', axis => {
    expect(compare(`use sequences
A = array shape 2 3 fill 1
Done = 0
for I in 1 to 2
 Done = I
 B = (A scan + axis ${axis}) mod 17
end`).state.error).toBeDefined();
});
it('retains ordinary demand budgets', () => {
    const source = `use sequences
A = array shape 2 3 fill 1
for I in 1 to 3
 B = (A scan + axis 1 with 7) mod 17
end`;
    for (const budget of [1, 10, 30]) expect(run(source, true, budget).state).toEqual(run(source, false, budget).state);
});

it.each(['1', '17', '2147483648'])('normalizes signed inputs and seeds modulo %s', modulus => {
    const result = compare(`use sequences
A = (array -9007199254740991 -7 0 13 -29 4) reshape 2 3
Mod = ${modulus}
Seed = -9007199254740991
for I in 1 to 3
 B = (A scan + axis 1 with Seed) mod Mod
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['0', '-17', '2147483649', '18446744073709551616'])('retains exact or invalid modulus %s', modulus => {
    compare(`use sequences
A = (1 to 6) reshape 2 3
for I in 1 to 3
 B = (A scan + axis 0 with 7) mod ${modulus}
end`);
});
it.each(['(A // A) scan + axis 0', '(A // A) scan + axis 0 with (1 // 0)'])('preserves input and seed failures: %s', prefix => {
    const result = compare(`use sequences
A = (array 1 0 2 3) reshape 2 2
Done = 0
for I in 1 to 3
 Done = I
 B = (${prefix}) mod 0
end`);
    expect(result.state.error).toContain('division by zero');
});

it('leaves malformed scan modifiers to ordinary error attribution', () => {
    expect(compare(`use sequences
A = array shape 2 3 fill 1
Done = 0
for I in 1 to 3
 Done = I
 B = (A scan + axis 1 with -7) mod 17
end`).state.error).toContain('scan expects');
});
