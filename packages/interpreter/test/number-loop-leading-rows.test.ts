import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(source: string, options: InterpreterOptions = {}, named = false) {
    const r = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options }), d = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        if (named) {
            r.execute('use sequences\nInput = (1 to 6) reshape 2 3');
            Object.defineProperty(r.variables.get('Input')!, 'columnNames', { value: ['A', 'B', 'C'] });
        }
        try { d.run(() => r.execute(source)); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, state: { error, variables: [...r.variables].map(([name, value]) => [name,
            isRankArray(value) ? { shape: value.shape, items: [...value.items], columns: value.columnNames } : formatValue(value)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, loops?: number, named = false) {
    const a = run(source, {}, named);
    expect(a.state).toEqual(run(source, { compilation: false }, named).state);
    expect(a.state).toEqual(run(source, { numberLoopCompilation: false }, named).state);
    if (loops !== undefined) expect(a.d.numberLoops).toBe(loops);
    return a;
}
it.each(['2 3', '2 3 4', '2 0 3', '2 3 0'].flatMap(shape => ['7', '1.5', 'true'].map(fill => ({ shape, fill }))))(
    'selects leading rows of $shape / $fill', ({ shape, fill }) => {
        expect(compare(`use sequences
Input = array shape ${shape} fill ${fill}
for I in 0 to 1
 Row = Input I
end`, 1).state.error).toBeUndefined();
    });
it('preserves nonuniform rows, retained aliases and later source writes', () => {
    expect(compare(`use sequences
Input = (1 to 12) reshape 2 2 3
Alias = Input
Saved = Input 0
for I in 0 to 1
 Row = Input I
 if I equal 0
  Saved = Row
 end
 Input I 0 0 = 99
 Row 0 0 = 88
end`, 1).state.error).toBeUndefined();
});
it('selects a row from a fresh expression and composes row selections', () => {
    expect(compare(`use sequences
Input = (1 to 12) reshape 2 2 3
for I in 0 to 1
 Row = (Input + I) I
 Line = Row 1
end`, 1).state.error).toBeUndefined();
});
it.each(['-1', '2', '9007199254740992', '1 // 0'])(
    'preserves selector errors and preceding writes for %s', index => {
        expect(compare(`use sequences
Input = (1 to 6) reshape 2 3
Done = 0
for I in 1 to 2
 Done = I
 Row = Input (${index})
end`).state.error).toBeDefined();
    });
it('rejects an absent row even when its trailing dimensions are empty', () => {
    expect(compare(`Input = array shape 0 3 fill 1
for I in 1 to 2
 Row = Input 0
end`).state.error).toBeDefined();
});
it('keeps wide integer rows exact', () => {
    expect(compare(`use sequences
Input = (array 18446744073709551616 2 3 4) reshape 2 2
for I in 0 to 1
 Row = Input I
end`).state.error).toBeUndefined();
});
it('retains real bit values and nonfinite cells', () => {
    expect(compare(`use numbers
use sequences
Input = (array -0.0 0.0 nan inf) reshape 2 2
for I in 0 to 1
 Row = Input I
end`).state.error).toBeUndefined();
});
it('retains named-column selection metadata', () => {
    compare(`for I in 0 to 1
 Row = Input I
end`, 0, true);
});
it('rechecks budgets for a warmed row consumer', () => {
    const r = new Interpreter(() => {});
    try {
        r.execute(`use sequences
fun Values row Index
 Result = Values Index
 for Turn in 1 to 2
  Result = Values Index
 end
 return Result
end
Input = (1 to 6) reshape 2 3`);
        const warm = new RuntimeDiagnostics();
        expect(formatValue(warm.run(() => r.execute('Input row 1'))!)).toBe('4 5 6');
        expect(warm.numberLoops).toBe(1);
        const d = new RuntimeDiagnostics();
        expect(formatValue(withDemandBudget(100000, () => d.run(() => r.execute('Input row 0')))!)).toBe('1 2 3');
        expect(d.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => r.execute('Input row 1'))).toThrow('demand budget exhausted');
    } finally { r.dispose(); }
});
it.each([
    ['2 3 4', '2 3 1'], ['2 3 4', '1 3 1'], ['2 3 4', '4'],
    ['2 3 4', '2 1 1'], ['2 3 4', '1 1 1'], ['2 3 4', '2 1 4'],
    ['1 3 4', '3 1'], ['2 0 4', '1 1 4'],
])('broadcasts varying integer and real leaves: %s / %s', (left, right) => {
    for (const real of [false, true]) {
        const size = (shape: string) => shape.split(' ').reduce((a,b) => a*Number(b), 1);
        const values = (n: number) => n ? Array.from({ length: n }, (_, i) => real ? `${i + 1}.5` : String(i + 1)).join(' ') : '';
        const array = (shape: string) => size(shape) ? `(array ${values(size(shape))}) reshape ${shape}` : `array shape ${shape} fill ${real ? '1.5' : '1'}`;
        expect(compare(`use sequences
A = ${array(left)}
B = ${array(right)}
for I in 1 to 2
 Result = (A + B) ${real ? '* 2.0' : 'mod 97'}
end`, 1).state.error).toBeUndefined();
    }
});
