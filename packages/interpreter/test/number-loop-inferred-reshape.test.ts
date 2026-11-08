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
it.each(['#', '# 3', '2 #', '# 1 3'])('compiles reshape %s without copying input cells', dimensions => {
    const result = compare(`use sequences
A = (1 to 6) copy
Total = 0
for I in 1 to 3
 B = A reshape ${dimensions}
 Total += B sum
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('retains independent writes through inferred views', () => {
    const result = compare(`use sequences
A = (1 to 6) copy
for I in 1 to 3
 B = A reshape # 3
 B 0 0 = I
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['#', '# 2', '3 #'])('infers empty shapes with %s', dimensions => {
    const result = compare(`use sequences
A = array shape 0 fill 1
for I in 1 to 3
 B = A reshape ${dimensions}
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['# #', '4 #', '0 #', '-1 #', '# (1 // 0)'])('preserves errors and prior writes with %s', dimensions => {
    expect(compare(`use sequences
A = (1 to 6) copy
Done = 0
for I in 1 to 3
 Done = I
 B = A reshape ${dimensions}
end`).state.error).toBeDefined();
});
it('retains observable budgets across inferred reshapes', () => {
    const source = `use sequences
A = (1 to 6) copy
for I in 1 to 3
 B = A reshape # 3
end`;
    for (const budget of [1, 10, 30]) expect(run(source, true, budget).state).toEqual(run(source, false, budget).state);
});
