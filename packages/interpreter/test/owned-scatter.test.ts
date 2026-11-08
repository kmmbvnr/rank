import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

function run(source: string, options: InterpreterOptions = {}, budget?: number) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined, result: string | undefined;
        const execute = () => diagnostics.run(() => runtime.execute(source));
        try {
            const value = budget === undefined ? execute() : withDemandBudget(budget, execute);
            if (value !== undefined) result = formatValue(value);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { diagnostics, state: { error, result,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, loops?: number) {
    const actual = run(source);
    expect(actual.state).toEqual(run(source, { compilation: false }).state);
    expect(actual.state).toEqual(run(source, { numberLoopCompilation: false }).state);
    if (loops !== undefined) expect(actual.diagnostics.numberLoops).toBe(loops);
    return actual;
}
const initial = `use sequences
A = array 2147483647 2 3 4
Saved = A
Keys = array 0 0 2 3
Input = array 10 20 30 40`;
it.each(['+=', '-=', '*='].flatMap(operation => ['', ' mod 1000000007'].map(modulus => ({ operation, modulus }))))(
    'detaches aliases for $operation with $modulus', ({ operation, modulus }) => {
        expect(compare(`${initial}
for Turn in 1 to 3
 Saved = A
 A Keys ${operation} Input${modulus} .accumulate
 Result = 0
end`, 1).state.error).toBeUndefined();
    });
it('reads the previous owner while updating a shared alias', () => {
    expect(compare(`${initial}
for Turn in 1 to 3
 Saved = A
 A Keys += Saved mod 1000000007 .accumulate
 Result = 0
end`, 1).state.error).toBeUndefined();
});
it('joins a fresh histogram and its carried state in one private helper', () => {
    const result = compare(`use sequences
Keys = array 0 0 1 2
Sources = array 0 1 1 2
fun Count terms
 Values = array 1 2 3
 Saved = Values
 Terms = array shape Count fill 0
 for Turn in 0 till Count
  Terms Turn = Values sum
  Next = array shape 3 fill 0
  Counts = Values Sources
  Next Keys += Counts mod 1000000007 .accumulate
  Values = Next
 end
 return Terms
end
Answer = 40 terms`, 1);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});
it('keeps Number checks after a repeated key widens the buffer', () => {
    const result = compare(`use sequences
A = array 2147483647
Keys = array 0 0 0
Input = array 1 4503599627370495 4503599627370495
for Turn in 1 to 2
 Saved = A
 A Keys += Input .accumulate
 Result = 0
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});
it('widens private histograms without replaying the whole region', () => {
    const result = compare(`use sequences
Keys = array 0 0 1
Input = array 2000000000 2000000000 2
for Turn in 1 to 3
 A = array shape 2 fill 0
 A Keys += Input .accumulate
 Result = A sum
end`, 1);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});
it.each([
    'A Keys += array 1 2 .accumulate',
    'A (array 0 9) += array 1 2 .accumulate',
    'A (array 0 -1) += array 1 2 .accumulate',
    'A (array 0 9) += (Input // 0) .accumulate',
    'A Keys += Input mod 0 .accumulate',
])('retains error ordering and saved cells: %s', statement => {
    expect(compare(`${initial}
for Turn in 1 to 2
 Saved = A
 A 1 += 1
 ${statement}
 Result = 0
end`).state.error).toBeDefined();
});
it('snapshots indices which are the destination itself', () => {
    expect(compare(`A = array 1 0 1
Input = array 1 2 3
for Turn in 1 to 1
 Saved = A
 A A += Input .accumulate
 Result = 0
end`).state.error).toBeUndefined();
});
it('leaves escaping compound array results and early control on the ordinary path', () => {
    compare(`${initial}
for Turn in 1 to 2
 Saved = A
 A Keys += Input .accumulate
end`, 0);
    compare(`${initial}
for Turn in 1 to 2
 Saved = A
 A Keys += Input .accumulate
 if Turn equal 1
  break
 end
end`, 0);
});
it.each([1, 20, 100, 1000])('retains demand work with budget %s', budget => {
    const source = `${initial}
for Turn in 1 to 3
 Saved = A
 A Keys += Input .accumulate
 Result = 0
end`;
    expect(run(source, {}, budget).state).toEqual(run(source, { compilation: false }, budget).state);
});
it('rechecks metadata when an owned accumulation warms up', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute(`A = array 1 2
Saved = A
Keys = array 0 0 1
Input = array 1 2 3`);
        const source = `for Turn in 1 to 2
 Saved = A
 A Keys += Input .accumulate
 Result = 0
end`;
        const warm = new RuntimeDiagnostics(); warm.run(() => runtime.execute(source));
        expect(warm.numberLoops).toBe(1);
        const value = typedArray(new Int32Array([1, 2]), [2]);
        Object.defineProperty(value, 'columnNames', { value: ['left', 'right'] });
        runtime.variables.set('A', value);
        const stats = new RuntimeDiagnostics(); stats.run(() => runtime.execute(source));
        expect(stats.numberLoops).toBe(0);
        expect(runtime.variables.get('Saved')).toHaveProperty('columnNames', ['left', 'right']);
    } finally { runtime.dispose(); }
});
it('rechecks cancellation after a cached accumulation region', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute(initial);
        const source = `for Turn in 1 to 3
 Saved = A
 A Keys += Input mod 1000000007 .accumulate
 Result = 0
end`;
        runtime.execute(source);
        const stats = new RuntimeDiagnostics();
        withInterrupt(new Int32Array(1), () => stats.run(() => runtime.execute(source)));
        expect(stats.numberLoops).toBe(0);
    } finally { runtime.dispose(); }
});
it.each([false, true])('retains mutable traversal semantics with an alias: %s', alias => {
    const setup = alias ? 'Saved = A\n' : '';
    const bind = alias ? ' Saved = A\n' : '';
    const result = compare(`use sequences
A = array 1 2 3
${setup}Keys = array 1 1
Input = array 2147483647 2147483647
Total = 0
for Value in A
${bind} A Keys += Input .accumulate
 Total += Value
end`, 0);
    expect(result.state.error).toBeUndefined();
});
it('checks a compact repeated multiply after its destination widens', () => {
    const result = compare(`use sequences
A = array 2147483647
Saved = A
Keys = array shape 25 fill 0
Input = array shape 25 fill 2
for Turn in 1 to 1
 Saved = A
 A Keys *= Input .accumulate
 Result = 0
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});
it('does not omit entry publication for a conditionally fresh destination', () => {
    expect(compare(`use sequences
A = array 1 2
Saved = A
Keys = array 0 0
Input = array 1 2
for Turn in 1 to 2
 if Turn greater 1
  A = array shape 2 fill 0
 end
 A Keys += Input .accumulate
 Result = 0
end`, 0).state.error).toBeUndefined();
});
it.each([0, 1, 1023, 1024, 1025, 2050])('resumes exactly once after compact promotion at cell %s', firstWide => {
    const result = compare(`use sequences
A = array 2147483647 0
Saved = A
Places = 0 till 2051 copy
Keys = Places at least ${firstWide} choose 0 1
Input = 1 to 2051 copy
for Turn in 1 to 1
 Saved = A
 A Keys += Input .accumulate
 Result = 0
end`, 1);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});
