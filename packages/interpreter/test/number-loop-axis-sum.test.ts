import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
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
    ['2 3', '0'], ['2 3', '1'], ['2 3 4', '0'], ['2 3 4', '1'], ['2 3 4', '2'],
    ['2 3 4', '0 2'], ['2 3 4', '2 0'], ['2 0 4', '1'], ['0 3 4', '1'],
])('compiles integer sum on shape %s axis %s', (shape, axis) => {
    const result = compare(`use sequences
A = array shape ${shape} fill 3
Total = 0
for I in 1 to 3
 B = (A * I + 1) sum axis ${axis}
 Total += B sum
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('fuses a broadcast producer and keeps saved results across pooled reuse', () => {
    const result = compare(`use sequences
A = (1 to 6) reshape 2 3 1
B = (1 to 4) reshape 1 1 4
Saved = array shape 2 4 fill 0
for I in 1 to 3
 C = (A * B + I) sum axis 1
 if I equal 1
  Saved = C
 end
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['9007199254740991', '18446744073709551616'])('replays wide sum %s exactly', value => {
    expect(compare(`use sequences
A = array shape 2 3 fill ${value}
Total = 0
for I in 1 to 2
 B = A sum axis 1
 Total += B sum
end`).state.error).toBeUndefined();
});
it.each(['0 0', '3', '-4'])('retains invalid axes %s and prior writes', axis => {
    expect(compare(`use sequences
A = array shape 2 3 fill 1
Done = 0
for I in 1 to 2
 Done = I
 B = A sum axis ${axis}
end`).state.error).toBeDefined();
});
it('retains observable budget execution', () => {
    const source = `use sequences
A = array shape 2 3 fill 1
for I in 1 to 5
 B = A sum axis 1
end`;
    for (const budget of [1, 10, 30]) expect(run(source, true, budget).state).toEqual(run(source, false, budget).state);
});
