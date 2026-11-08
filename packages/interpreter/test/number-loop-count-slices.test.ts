import { ownedArray } from '../src/array-storage.js';
import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray, withDemandBudget } from '../src/index.js';

function run(source: string, compilation: boolean) {
    const r = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false }), d = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { d.run(() => r.execute(source)); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, state: { error, values: [...r.variables].map(([key, value]) => [key,
            isRankArray(value) ? { shape: value.shape, items: [...value.items] } : formatValue(value)]) } };
    } finally { r.dispose(); }
}
const shapes = ['6', '2 3', '1 2 3', '0 3', '2 0 3'];
it.each(shapes.flatMap(shape => ['take', 'drop'].flatMap(op => [0, 1, 2, 9].map(count => ({ shape, op, count })))))(
    'compiles $op $count on shape $shape', ({ shape, op, count }) => {
        const source = `use sequences
Input = array shape ${shape} fill 7
Result = Input copy
for Turn in 1 to 2
 Part = Input ${op} ${count}
 Result = Part copy
end`;
        const actual = run(source, true);
        expect(actual.state).toEqual(run(source, false).state);
        expect(actual.state.error).toBeUndefined();
        expect(actual.d.numberLoops).toBe(1);
    });
it.each(['true', '-0.0', '1.5', '9007199254740991'])(
    'preserves element kinds and widening for %s', value => {
        const source = `use sequences
Input = array shape 2 3 fill ${value}
Result = Input copy
for Turn in 1 to 2
 Part = Input drop 1
 Result = Part take 1
end`;
        const actual = run(source, true);
        expect(actual.state).toEqual(run(source, false).state);
        expect(actual.d.numberLoops).toBe(1);
    });
it('retains previous slices while their original source is written', () => {
    const source = `use sequences
Input = array 1 2 3
Saved = array shape 0 fill 0
Result = array shape 0 fill 0
for Turn in 1 to 2
 Part = Input take 2
 if Turn equal 1
  Saved = Part
 end
 Input 0 += 10
 Result = Input drop 1
end`;
    const actual = run(source, true);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.d.numberLoops).toBe(1);
});
it.each(['-1', '1.5', 'true', '9007199254740993'])(
    'retains exact counts or count errors for %s', count => {
        const source = `use sequences
Input = array 1 2 3
Done = 0
Result = array shape 0 fill 0
for Turn in 1 to 2
 Done = Turn
 Result = Input take ${count}
end`;
        expect(run(source, true).state).toEqual(run(source, false).state);
    });
it.each(['(Input // 0) take 0', '(Input (array 0 99)) take 1', '(Input (array 0 99)) drop 2', '(Input // 0) drop -1'])(
    'keeps source demand and error timing for %s', expression => {
        const source = `use sequences
Input = array 1 2 3
Done = 0
Result = array shape 0 fill 0
for Turn in 1 to 2
 Done = Turn
 Result = ${expression}
end`;
        expect(run(source, true).state).toEqual(run(source, false).state);
    });
it('retains sequence semantics instead of array broadcasting', () => {
    const source = `use sequences
Result = array shape 0 fill 0
for Turn in 1 to 2
 Result = (1 to 10) take Turn
end`;
    expect(run(source, true).state).toEqual(run(source, false).state);
});
it('retains a warmed function under observable budgets', () => {
    const r = new Interpreter(() => {});
    try {
        r.execute(`use sequences
fun Values sliced Count
 Result = array shape 0 fill 0
 for Turn in 1 to 2
  Part = Values drop Count
  Result = Part take 2
 end
 return Result
end`);
        r.execute('Input = array 1 2 3 4');
        expect(formatValue(r.execute('Input sliced 1')!)).toBe('2 3');
        const d = new RuntimeDiagnostics();
        expect(formatValue(withDemandBudget(100000, () => d.run(() => r.execute('Input sliced 2')))!)).toBe('3 4');
        expect(d.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => r.execute('Input sliced 1'))).toThrow('demand budget exhausted');
    } finally { r.dispose(); }
});

it('keeps named-column inputs on the ordinary count-slice path', () => {
    const results: unknown[] = [];
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation }), d = new RuntimeDiagnostics();
        try {
            r.variables.set('Input', ownedArray([1n, 2n, 3n, 4n, 5n, 6n], [2, 3], true, ['A', 'B', 'C']));
            d.run(() => r.execute(`use sequences
Result = Input take 1
for Turn in 1 to 2
 Result = Input take 1
end`));
            const result = r.variables.get('Result')!;
            if (!isRankArray(result)) throw Error('missing result');
            results.push({ shape: result.shape, items: [...result.items], columns: result.columnNames });
            if (compilation) expect(d.numberLoops).toBe(0);
        } finally { r.dispose(); }
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({ shape: [1, 3], items: [1n, 2n, 3n], columns: undefined });
});
