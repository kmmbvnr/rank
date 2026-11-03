import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, parse } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';

function observe(source: string, compilation: boolean, input?: () => RankArray) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        if (input) runtime.variables.set('A', input());
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
function compare(source: string, input?: () => RankArray) {
    const actual = observe(source, true, input);
    expect(actual.state).toEqual(observe(source, false, input).state);
    return actual;
}

it.each(['int32', 'int64', 'boxed'])('reads validated %s matrix cells while a private store widens', kind => {
    const source = `B = array shape 2 2 fill 0
for I in 0 to 1
  for J in 0 to 1
    B I J = A I J + 1
  end
end`;
    const values = [1n, -2n, 2147483647n, 17n];
    const actual = compare(source, () => kind === 'boxed' ? ownedArray(values.slice(), [2, 2], true)
        : typedArray(kind === 'int32' ? Int32Array.from(values, Number) : BigInt64Array.from(values), [2, 2]));
    expect(actual.diagnostics.numberLoops).toBe(1);
    expect(actual.state.error).toBeUndefined();
});

it('keeps unchecked packed read-only cells behind the actual-read guard', () => {
    const actual = compare(`S = 0
for I in 0 till 2
  if I equal 0
    S += A I
  end
end`, () => typedArray(BigInt64Array.from([1n, 9007199254740993n])));
    expect(actual.diagnostics.numberLoops).toBe(1);
    expect(actual.diagnostics.numberLoopOverflows).toBe(0);
});

it.each([false, true])('declines numeric preparation for a wide source cell (read=%s)', active => {
    const actual = compare(`A = array 1 9007199254740993
B = array shape 2 fill 0
for I in 0 till 2
  ${active ? 'B I = A I' : 'if I equal 0\n    B I = A I\n  end'}
end`);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoops).toBe(0);
    expect(actual.diagnostics.fallbacks['number-loop:unsafe-cell']).toBeGreaterThan(0);
});

it('keeps arithmetic overflow checks after a trusted load and replays private writes', () => {
    const actual = compare(`A = array 1 9007199254740990
B = array shape 2 fill 0
for I in 0 till 2
  B I = A I + 10
end`);
    expect(actual.diagnostics.numberLoops).toBe(1);
    expect(actual.diagnostics.numberLoopOverflows).toBe(1);
    expect(actual.state.error).toBeUndefined();
});

it('revalidates a cached read buffer after a wide mutation', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute('A = array 1 2\nB = array shape 2 fill 0');
        const program = parse('for I in 0 till 2\n  B I = A I\nend');
        const first = new RuntimeDiagnostics();
        first.run(() => runtime.executeProgram(program));
        expect(first.numberLoops).toBe(1);
        runtime.execute('A 1 = 9007199254740993');
        const second = new RuntimeDiagnostics();
        second.run(() => runtime.executeProgram(program));
        expect(second.numberLoops).toBe(0);
        expect(formatValue(runtime.variables.get('B')!)).toBe('1 9007199254740993');
    } finally { runtime.dispose(); }
});

it.each(['A I + 10', 'A I // (1 - I)'])('publishes the ordinary error prefix for %s', value => {
    const actual = compare(`A = array 1 2
B = array shape 3 fill 0
for I in 0 till 3
  B I = ${value}
end`);
    expect(actual.diagnostics.numberLoops).toBe(1);
    expect(actual.state.error).toBeDefined();
});
