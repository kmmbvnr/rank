import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, parse } from '../src/index.js';
import { native } from '../src/modules/shared.js';

function run(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: unknown;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) {
            expect(failure).toBeInstanceOf(RankError);
            error = (failure as RankError).format();
        }
        return { diagnostics, state: { error,
            values: [...runtime.variables].map(([key, value]) => [key, formatValue(value)]),
        } };
    } finally { runtime.dispose(); }
}

it.each(['I sqrt ceil + 1', 'I sqrt abs ceil', 'I isqrt abs'])('keeps unary chain %s in a Number loop', expression => {
    const source = `use numbers
A = array shape 8 fill 0
for I in 0 till 8
  A I = ${expression}
end`;
    const actual = run(source, true);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.diagnostics.numberLoops).toBe(1);
    expect(actual.state.error).toBeUndefined();
});

it.each(['(I - 1) sqrt ceil', 'I / (1 - I) sqrt ceil'])('keeps the ordinary error prefix for %s', expression => {
    const source = `use numbers
A = array shape 8 fill 0
for I in 0 till 8
  A I = ${expression}
end`;
    const actual = run(source, true);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.diagnostics.numberLoops).toBe(1);
    expect(actual.state.error).toBeDefined();
});

it.each(['sqrt', 'ceil'])('rechecks %s in a cached unary chain before running', operation => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute('use numbers\nA = array shape 4 fill 0');
        const program = parse('for I in 0 till 4\n  A I = I sqrt ceil\nend');
        const before = new RuntimeDiagnostics();
        before.run(() => runtime.executeProgram(program));
        expect(before.numberLoops).toBe(1);
        const seen: unknown[] = [];
        runtime.variables.set(operation, native('replacement', 1, ([value]) => {
            seen.push(value); return operation === 'sqrt' ? 4.25 : 7n;
        }));
        runtime.executeProgram(program);
        expect(formatValue(runtime.variables.get('A')!)).toBe(operation === 'sqrt' ? '5 5 5 5' : '7 7 7 7');
        expect(seen).toEqual(operation === 'sqrt' ? [0n, 1n, 2n, 3n] : [0, 1, Math.sqrt(2), Math.sqrt(3)]);
    } finally { runtime.dispose(); }
});
