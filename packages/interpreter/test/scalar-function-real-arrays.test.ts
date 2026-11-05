import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction, RankError } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';

function invoke(source: string, args: (number | bigint | boolean)[], compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, sourceId: '/virtual/real.ra' });
    const diagnostics = new RuntimeDiagnostics();
    try {
        // Both calls can use the scalar backend through a linked helper.
        const call = args.length === 1 ? 'X sample' : 'X sample Y';
        runtime.execute(source + `\nfun X bridge ${args.length === 1 ? '' : 'Y'}
  R = ${call}
  for J in 1 to 1
    R = ${call}
  end
  return R
end`);
        const fn = runtime.variables.get('bridge');
        if (!fn || !isNativeFunction(fn)) throw Error('missing bridge');
        const value = diagnostics.run(() => fn.call(args));
        return { value, diagnostics };
    } finally { runtime.dispose(); }
}

it('keeps fractional, signed-zero and nonfinite real fills, unary negation and compound writes', () => {
    const source = `fun X sample Twice
  A = array shape 2 fill X
  A 1 *= 2.0
  if Twice
    return A 1
  end
  return - (A 0)
end`;
    for (const x of [0.25, -0.25, 0, -0, Infinity, -Infinity, NaN]) {
        for (const twice of [false, true]) {
            const expected = invoke(source, [x, twice], false);
            const actual = invoke(source, [x, twice]);
            expect(actual.value).toBe(expected.value);
            expect(actual.diagnostics.numberFunctions).toBe(2);
            expect(actual.diagnostics.numberFunctionFallbacks).toBe(0);
        }
    }
});

it('retains integer overflow replay after writing private real cells', () => {
    for (const result of ['A', 'B']) {
        const source = `fun X sample N
  A = array shape 1 fill 0.25
  B = array shape 1 fill 0
  for I in 1 to N
    A 0 += 0.25
    B 0 += X
  end
  return ${result} 0
end`;
        const expected = invoke(source, [4000000000000000n, 3n], false);
        const actual = invoke(source, [4000000000000000n, 3n]);
        expect(actual.value).toBe(expected.value);
        expect(actual.value).toBe(result === 'A' ? 1.0 : 12000000000000000n);
        expect(actual.diagnostics.numberFunctions).toBe(1);
        expect(actual.diagnostics.numberFunctionFallbacks).toBe(1);
        expect(invoke(source, [2n, 3n]).diagnostics.numberFunctionFallbacks).toBe(0);
    }
});

it('keeps wide integer arguments out of Number entry alongside real arguments', () => {
    const source = `fun X sample N
  A = array shape 1 fill X
  A 0 += X
  return N + 1
end`;
    const args = [0.125, 9007199254740993n];
    expect(invoke(source, args).value).toBe(9007199254740994n);
    expect(invoke(source, args).diagnostics.numberFunctions).toBe(0);
});

it('retains located errors and fractional arguments when called from a compiled loop', () => {
    const source = `fun X sample
  Y = X + 0.5
  return Y / 0.0
end
Sum = 0.0
for I in 1 to 1000
  Sum += 0.25 sample
end`;
    const observations = [false, true].map(compilation => {
        const runtime = new Interpreter(() => {}, { compilation, sourceId: '/virtual/real.ra' });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            throw Error('expected division error');
        } catch (error) {
            expect(error).toBeInstanceOf(RankError);
            if (compilation) {
                expect(diagnostics.numberFunctions).toBeGreaterThan(0);
                expect(diagnostics.numberLoops).toBeGreaterThan(0);
            }
            const failure = error as RankError;
            expect(failure.formatCalls()).toContain('X = 0.25');
            return { message: failure.message, location: failure.location };
        } finally { runtime.dispose(); }
    });
    expect(observations[1]).toEqual(observations[0]);
    expect(observations[1].message).toContain('division by zero');
});

it('replays invalid indices with the ordinary error, and recovers on a later call', () => {
    const source = `fun X sample K
  A = array shape 2 fill X
  A 0 += X
  A K = X
  return A 0
end`;
    const observations = [false, true].map(compilation => {
        try { invoke(source, [0.25, 2n], compilation); }
        catch (error) { expect(error).toBeInstanceOf(RankError); return (error as Error).message; }
        throw Error('expected bounds error');
    });
    expect(observations[1]).toBe(observations[0]);
    expect(invoke(source, [0.25, 1n]).value).toBe(0.5);
});

it('does not speculate when an array alias or result can escape', () => {
    for (const source of [`fun X sample
  A = array shape 2 fill X
  B = A
  B 0 += X
  return A 0
end`, `fun X sample
  A = array shape 2 fill X
  A 0 += X
  return A
end`]) {
        const actual = invoke(source, [0.25]);
        expect(actual.diagnostics.numberFunctions).toBe(0);
    }
});

it('polls cancellation inside a Number function with real storage and then recovers', () => {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    let armed = true;
    const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => {
        if (armed) Atomics.store(signal, 0, 1);
    } });
    try {
        runtime.execute(`fun X sample N
  A = array shape 1 fill X
  for I in 1 to N
    A 0 += X
  end
  return A 0
end
fun X bridge N
  R = X sample N
  for J in 1 to 1
    R = X sample N
  end
  return R
end`);
        const fn = runtime.variables.get('bridge');
        if (!fn || !isNativeFunction(fn)) throw Error('missing bridge');
        const diagnostics = new RuntimeDiagnostics();
        // Request cancellation at compiled function entry, so its own loop
        // must poll. An opaque atomic signal keeps the private backend enabled.
        expect(() => diagnostics.run(() => withInterrupt(signal, () => fn.call([0.25, 1000000n])))).toThrow('Interrupted');
        expect(diagnostics.numberFunctions).toBeGreaterThan(0);
        armed = false;
        Atomics.store(signal, 0, 0);
        expect(fn.call([0.25, 2n])).toBe(0.75);
    } finally { runtime.dispose(); }
});
