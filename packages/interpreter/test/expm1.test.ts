import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget } from '../src/interrupt.js';

it.each([false, true])('retains small values and real kinds with compilation=%s', compilation => {
    const r = new Interpreter(() => {}, { compilation });
    try {
        expect(r.execute('use numbers\n0.000000000000000001 expm1')).toBe(1e-18);
        expect(r.execute('(-0.000000000000000001) expm1')).toBe(-1e-18);
        expect(r.execute('0.0 exp - 1.0')).toBe(0.0);
        expect(r.execute('0 expm1')).toBe(0.0);
        expect(r.execute('(-1000) expm1')).toBe(-1.0);
        expect(r.execute('1000 expm1')).toBe(Infinity);
        expect(r.execute('nan expm1')).toBeNaN();
        expect(formatValue(r.execute('(array 0 1) expm1')!)).toBe('0 1.718281828459045');
        expect(formatValue(r.execute('((0 to 2) expm1) array')!)).toBe('0 1.718281828459045 6.38905609893065');
        expect(() => formatValue(r.execute('"text" expm1')!)).toThrow('expm1 expects numeric input');
    } finally { r.dispose(); }
});
it('compiles scalar and array expm1 in a numeric loop', () => {
    const source = `use numbers
use sequences
A = array shape 2 3 fill 0.000000000000000001
Total = 0.0
for I in 1 to 3
 B = A expm1
 Total += B sum
 Total += 0.000000000000000001 expm1
end`;
    const actual: string[] = [];
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false }), d = new RuntimeDiagnostics();
        try {
            d.run(() => r.execute(source));
            actual.push(formatValue(r.variables.get('Total')!));
            if (compilation) expect(d.numberLoops).toBe(1);
        } finally { r.dispose(); }
    }
    expect(actual[1]).toBe(actual[0]);
});
it('retains a warmed native binding guard and budget behavior', () => {
    const source = `use numbers
fun X total
 Total = 0.0
 for I in 1 to 3
  Total += X expm1
 end
 return Total
end`;
    const r = new Interpreter(() => {});
    try {
        r.execute(source);
        expect(r.execute('0.0 total')).toBe(0.0);
        expect(() => withDemandBudget(1, () => r.execute('0.0 total'))).toThrow('demand budget exhausted');
        r.variables.set('expm1', native('expm1', 1, () => 7.0));
        expect(r.execute('0.0 total')).toBe(21.0);
    } finally { r.dispose(); }
});

it('fuses stable exponential maps with surrounding array arithmetic', () => {
    const source = `use numbers
use sequences
A = array shape 4 25 fill -0.000000000000000001
Weight = array shape 4 25 fill -0.5
Result' = Weight * (A expm1)
Result copy`;
    const values: string[] = [];
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation }), d = new RuntimeDiagnostics();
        try {
            values.push(d.run(() => formatValue(r.execute(source)!)));
            if (compilation) expect(d.compiledTensors).toBeGreaterThan(0);
        } finally { r.dispose(); }
    }
    expect(values[1]).toBe(values[0]);
    expect(values[1]).toBe(Array(100).fill('5e-19').join(' '));
});
it.each(['array 1000 -1000', 'array nan 0.0', 'array infinity -infinity'])('keeps exceptional real values in an array map: %s', input => {
    const values: string[] = [];
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation });
        try { values.push(formatValue(r.execute(`use numbers\nResult = (${input}) expm1 * 1.0\nResult`)!)); }
        finally { r.dispose(); }
    }
    expect(values[1]).toBe(values[0]);
});
