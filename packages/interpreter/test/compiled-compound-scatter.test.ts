import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, RankError } from '../src/index.js';
import { withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';

function execute(source: string, compilation: boolean, numberLoopCompilation = true, budget?: number, observed = false) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics(), words = [0, 0, 0];
    const signal: InterruptSignal = { length: 3, load: i => words[i], store: (i, v) => { words[i] = v; },
        exchange(i, v) { const old = words[i]; words[i] = v; return old; }, wait() { throw Error('unexpected pause'); } };
    try {
        let result: string | undefined, error: string | undefined;
        const run = () => { const value = runtime.execute(source); result = value === undefined ? undefined : formatValue(value); };
        try { diagnostics.run(() => budget !== undefined ? withDemandBudget(budget, run)
            : observed ? withInterrupt(signal, run, () => {}) : run()); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { diagnostics, observation: { result, error,
            state: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, budget?: number, observed = false) {
    const actual = execute(source, true, true, budget, observed);
    expect(actual.observation).toEqual(execute(source, false, false, budget, observed).observation);
    expect(actual.observation).toEqual(execute(source, true, false, budget, observed).observation);
    return actual;
}
const head = 'A = array 2 3 4\nSaved = A\nKeys = array 2 0 2\nValues = array 5 7 11\nDone = 0\n';

it.each(['+=', '-=', '*='])('snapshots duplicate numeric destinations for %s', operator => {
    const result = compare(head + `for I in 1 to 2\n A Keys ${operator} Values\n Done = I\nend\ntuple A Saved`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});
it.each(['A Keys', 'A', 'Keys', '7'])('snapshots aliased compound operands: %s', rhs => {
    const result = compare(head + `for I in 1 to 2\n A Keys += ${rhs}\n Done = I\nend\nA`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('snapshots an index array which is also the destination', () => {
    const result = compare('A = array 1 0 1\nSaved = A\nfor I in 1 to 2\n A A += 1\nend\ntuple A Saved');
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['+=', '-=', '*='])('keeps real compound arithmetic and negative zero for %s', operator => {
    const result = compare(head.replace('array 2 3 4', 'array -0.0 2.5 3.5')
        + `for I in 1 to 2\n A Keys ${operator} -0.0\nend`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['A Keys', '7'])('returns the original compound RHS %s', rhs => {
    const result = compare(head + `for I in 1 to 2\n A Keys += ${rhs}\nend`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(rhs === '7' ? 1 : 0);
});
it.each([
    'A (Keys + I) += Values', 'A Keys += array 1 2', 'A Keys += true',
    'A Keys *= 9007199254740991', 'A Keys += 2147483647',
    'A (Keys + 9007199254740991) += Values',
])('retains state, widening and errors for %s', statement => {
    compare(head + `for I in 1 to 2\n ${statement}\n Done = I\nend\nA`);
});
it('accepts an empty selection and still evaluates its scalar RHS', () => {
    const result = compare(head.replace('Keys = array 2 0 2', 'Keys = array shape 0 fill 0')
        + 'for I in 1 to 2\n A Keys += 7\nend');
    expect(result.observation.result).toBe('7');
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each([true, false])('keeps observer boundaries: %s', observed => {
    compare(head + 'for I in 1 to 2\n A Keys += Values\n Done = I\nend', undefined, observed);
});
it.each([1, 20, 50, 100, 1000])('keeps demand budget %s', budget => {
    compare(head + 'for I in 1 to 2\n A Keys += Values\n Done = I\nend', budget);
});
it('rechecks budgets after an ordinary helper invocation', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(`use sequences
fun Values update
 A = Values copy
 Keys = array 0 0 1
 for I in 1 to 3
  A Keys += 7
 end
 return A
end`);
        runtime.execute('(array 1 2) update');
        const diagnostics = new RuntimeDiagnostics();
        const result = withDemandBudget(1000000, () => diagnostics.run(() => runtime.execute('(array 1 2) update')));
        expect(formatValue(result!)).toBe('22 23');
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
        expect(() => withDemandBudget(1, () => runtime.execute('(array 1 2) update'))).toThrow('demand budget exhausted');
    } finally { runtime.dispose(); }
});

const localScatter = `use sequences
A = array 2 3 4
Saved = A
Keys = array 2 0 2
for I in 1 to 3
 Values = (1 to 3) * I
 A Keys = Values
end`;
it('returns a completed named local array from a compiled scatter', () => {
    const result = compare(localScatter);
    expect(result.observation.error).toBeUndefined();
    expect(result.observation.result).toBe('3 6 9');
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['0', '1', '5'])('retains named results across %s iterations and buffer reuse', last => {
    compare(localScatter.replace('1 to 3\n Values', `1 to ${last}\n Values`));
});
it.each([
    ' Values 0 = I',
    ' Alias = Values\n Alias 0 = I',
    ' Alias = Values\n Alias 0 = 9007199254740992',
])('preserves mutable local results: %s', update => {
    compare(localScatter.replace(' A Keys = Values', update + '\n A Keys = Values'));
});
it('preserves source/result aliases after a named result escapes', () => {
    const result = compare(localScatter.replace('for I in', 'Values = array 0 0 0\nfor I in') + '\nRetained = Values\nA 0 = 99\nValues 1 = 77\ntuple A Retained Values Saved');
    expect(result.observation.error).toBeUndefined();
});
it.each([
    ' (1 to 3) * 9007199254740991',
    ' A Keys',
    ' A',
    ' Keys',
])('retains exact replay and source aliases for%s', rhs => {
    compare(localScatter.replace(' (1 to 3) * I', rhs));
});
it('retains a prior iteration result when a later iteration breaks', () => {
    compare(localScatter.replace(' Values =', ' if I equal 3\n  break\n end\n Values ='));
});
it('retains earlier writes and located failures', () => {
    compare(localScatter.replace(' A Keys = Values', ' A (Keys + I - 1) = Values'));
});
it.each([1, 20, 50, 100, 1000])('retains named scatter demand budget %s', budget => {
    // Existing vector expressions charge demand differently from the fully
    // interpreted path. Keep the exact compiled path's publication boundaries.
    const result = execute(localScatter, true, true, budget);
    expect(result.observation).toEqual(execute(localScatter, true, false, budget).observation);
    expect(result.diagnostics.numberLoops).toBe(0);
});
it('retains named scatter observer boundaries', () => {
    compare(localScatter, undefined, true);
});
