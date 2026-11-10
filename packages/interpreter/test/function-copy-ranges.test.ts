import { expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { Interpreter, parse, formatValue, RankError } from '../src/index.js';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';

const definition = `fun Input subtotal Limit
 Span = 1 to Limit copy
 Selected = Input Span
 return Selected sum
end`;
function run(text: string, compilation: boolean) {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        try { return { value: formatValue(runtime.execute(text)!), calls }; }
        catch (e) { return { error: e instanceof RankError ? e.format() : String(e), calls }; }
    } finally { runtime.dispose(); }
}
it('proves an explicitly copied range in an ordinary function binding', () => {
    const fn = parse(definition).statements[0];
    if (!isFunctionStatement(fn)) throw Error('expected function');
    expect(compileScalarFunction(fn, [{ kind: 'array', element: 'integer', rank: 1 }, 'integer'], true)).toBeDefined();
});
it.each(['array 1 2 3 4', 'array 1 9007199254740993 3 4', 'array 1.5 2.5 3.5 4.5'])('retains arithmetic for %s', input => {
    const text = `use numbers\nuse sequences\n${definition}\n(${input}) subtotal 3`;
    const compiled = run(text, true), reference = run(text, false);
    expect({ ...compiled, calls: 0 }).toEqual(reference);
    expect(compiled.calls).toBeGreaterThan(0);
});
it.each([0, 5])('retains empty ranges and gather errors at bound %s', limit => {
    const text = `use numbers\nuse sequences\n${definition}\n(array 1 2 3 4) subtotal ${limit}`;
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
});
it('does not treat a shadowed copy as the native completion operation', () => {
    const text = `use numbers\nuse sequences\n${definition.replace(' Span =', ' copy = 7\n Span =')}\n(array 1 2 3 4) subtotal 3`;
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
});

const nested = `fun Size offset Start
 Values = Start + 2 * (0 till Size copy)
 return Values sum
end`;
it('proves a copied range nested in an eager arithmetic operand', () => {
    const fn = parse(nested).statements[0];
    if (!isFunctionStatement(fn)) throw Error('expected function');
    expect(compileScalarFunction(fn, ['integer', 'integer'], true)).toBeDefined();
});
it.each([[5, '10'], [0, '10'], [5, '9007199254740993'], [5, '0.5']] as const)('retains nested range arithmetic at size %s and start %s', (size, start) => {
    const text = `use sequences\n${nested}\n${size} offset ${start}`;
    const compiled = run(text, true);
    expect({ ...compiled, calls: 0 }).toEqual(run(text, false));
    expect(compiled.calls).toBeGreaterThan(0);
});
it.each([false, true])('preserves conditional range-copy errors with demand=%s', demanded => {
    const text = `use sequences
fun Used probe
 if Used
  Values = 2 * (1 to 5 by 0 copy)
  return Values sum
 end
 return 7
end
${demanded} probe`;
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
    expect(run(text, true).error !== undefined).toBe(demanded);
});
it.each([false, true])('keeps deferred range-copy demand timing with demand=%s', demanded => {
    const text = `use sequences
fun Used probe
 Values' = 2 * (1 to 5 by 0 copy)
 if Used
  return Values sum
 end
 return 7
end
${demanded} probe`;
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
    expect(run(text, true).error !== undefined).toBe(demanded);
});
it('does not complete a bare lazy range for a metadata consumer', () => {
    const text = `use sequences
fun Size count_range
 return (1 to Size) len
end
5 count_range`;
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
});
it('retains a shadowed nested copy and its ordinary error', () => {
    const text = `use sequences\n${nested.replace(' Values =', ' copy = 7\n Values =')}\n3 offset 10`;
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
});
