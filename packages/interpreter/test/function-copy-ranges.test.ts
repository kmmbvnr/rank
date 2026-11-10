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
