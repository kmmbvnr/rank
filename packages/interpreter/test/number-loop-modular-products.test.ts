import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(source: string, options: InterpreterOptions = {}, budget?: number) {
    const r = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options }), d = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        const execute = () => d.run(() => r.execute(source));
        try { if (budget === undefined) execute(); else withDemandBudget(budget, execute); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, state: { error, variables: [...r.variables].map(([name, value]) => [name,
            isRankArray(value) ? { shape: value.shape, items: [...value.items] } : formatValue(value)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, loops?: number) {
    const a = run(source);
    expect(a.state).toEqual(run(source, { compilation: false }).state);
    expect(a.state).toEqual(run(source, { numberLoopCompilation: false }).state);
    if (loops !== undefined) expect(a.d.numberLoops).toBe(loops);
    return a;
}
it.each(['1', '17', '135707531', '1073741825', '2147483648'].flatMap(mod =>
    [['2 3', '0'], ['2 3', '1'], ['2 3 2', '-1'], ['0 3', '0'], ['2 0 3', '1'], ['2 3 0', '0']].flatMap(([shape, axis]) =>
        ['', ' with Seed'].map(seed => ({ mod, shape, axis, seed })))))('compiles modular product $mod / $shape / $axis / $seed', ({ mod, shape, axis, seed }) => {
    const a = compare(`use sequences
A = array shape ${shape} fill -2000000000
Seed = -9007199254740991
for I in 1 to 2
 B = (A scan * axis ${axis}${seed}) mod ${mod}
end`, 1);
    expect(a.state.error).toBeUndefined();
});
it('retains snapshots and pooled scan operands', () => {
    expect(compare(`use sequences
A = array 2 3 5 7
Saved = A
for I in 1 to 3
 B = (A + I) scan * with I mod 135707531
 if I equal 1
  Saved = B
 end
 A (0 to 3) += I
end`, 1).state.error).toBeUndefined();
});
it.each(['9007199254740992', '18446744073709551617'])('replays wide cells %s exactly', value => {
    expect(compare(`use sequences
A = array ${value} -7 0 13
for I in 1 to 2
 B = A scan * with I mod 17
end`).state.error).toBeUndefined();
});
it.each(['0', '-17', '2147483649', '18446744073709551616'])('retains exact or invalid modulus %s', mod => {
    compare(`use sequences
A = array 2 3 5
Done = 0
for I in 1 to 2
 Done = I
 B = A scan * with I mod ${mod}
end`);
});
it('preserves source errors before seed and modulus errors', () => {
    expect(compare(`use sequences
A = array 1 0 2
for I in 1 to 2
 B = (A // A) scan * with (1 // 0) mod 0
end`).state.error).toContain('division by zero');
});
it('retains observable scan work budgets', () => {
    const source = `use sequences
A = array 2 3 5 7
for I in 1 to 2
 B = A scan * with I mod 17
end`;
    for (const budget of [1, 10, 30, 100]) expect(run(source, {}, budget).state).toEqual(run(source, { compilation: false }, budget).state);
});

it.each(['0', '1', '-1'])('keeps independent nonuniform product lanes on axis %s', axis => {
    expect(compare(`use sequences
A = (1 to 12) reshape 2 3 2
Seed = -7
for I in 1 to 2
 B = (A scan * axis ${axis} with Seed) mod 1073741825
end`, 1).state.error).toBeUndefined();
});
