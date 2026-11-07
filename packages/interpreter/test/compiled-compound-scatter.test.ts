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
