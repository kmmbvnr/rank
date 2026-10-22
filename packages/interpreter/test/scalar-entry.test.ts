import { describe, expect, it } from 'vitest';
import { withInterrupt } from '../src/interrupt.js';
import { ByteArray } from '../src/bytes.js';
import { Interpreter, RankError, isNativeFunction, formatValue, type RankValue } from '../src/index.js';

function compare(source: string, inputs: RankValue[][], expectedCalls: number) {
    const results = [false, true].map(scalarEntryCompilation => {
        let calls = 0;
        const runtime = new Interpreter(undefined, {
            scalarEntryCompilation, integerLoopCompilation: false,
            onScalarFunctionExecuted: () => calls++,
        });
        try {
            runtime.execute(source);
            const fn = runtime.variables.get('helper');
            if (!isNativeFunction(fn!)) throw new Error('missing helper');
            const values = inputs.map(args => {
                try { return { value: formatValue(fn.call(args)) }; }
                catch (error) { return { error: error instanceof RankError ? error.format() : String(error) }; }
            });
            return { values, calls };
        } finally { runtime.dispose(); }
    });
    expect(results[1].values).toEqual(results[0].values);
    expect(results[0].calls).toBe(0);
    expect(results[1].calls).toBe(expectedCalls);
    return results[1].values;
}

describe('scalar compilation at ordinary function entry', () => {
    it('returns homogeneous scalar vectors from a compiled loop', () => {
        const values = compare(`fun X helper
  Sum = X
  Count = X - X
  for I in 0 to 4
    Sum += X
    Count += X - X + 1
  end
  return array Sum Count
end`, [[3n], [2.0], [-0]], 3);
        expect(values[0].value).toBe('18 5');
    });

    it('keeps vector results independently owned across calls and writes', () => {
        const runtime = new Interpreter(undefined);
        try {
            runtime.execute(`fun X helper
  return array X (X + 1)
end
A = 3 helper
B = 7 helper
Saved = A
A 0 = 99`);
            expect(formatValue(runtime.variables.get('A')!)).toBe('99 4');
            expect(formatValue(runtime.variables.get('Saved')!)).toBe('3 4');
            expect(formatValue(runtime.variables.get('B')!)).toBe('7 8');
        } finally { runtime.dispose(); }
    });

    it('declines mixed scalar and nested vector literals', () => {
        compare('fun X helper\n return array X 1.0\nend', [[2n]], 0);
        compare('fun X helper\n return array (array X X)\nend', [[2n]], 0);
        compare('fun X helper\n return array -X X\nend', [[2n]], 0);
        compare('fun X helper\n return array X X\nend', [[new ByteArray(new Uint8Array([1, 2]))]], 0);
    });

    it('preserves scalar kinds and signed zero in vector results', () => {
        compare('fun X helper\n return array X X\nend', [[3n], [-0], [true], ['hello']], 4);
    });

    it('locates vector element errors and recovers for the next call', () => {
        compare('fun X helper\n return array X (10 // X)\nend', [[0n], [2n]], 2);
    });

    it('guards each invocation and recovers after invalid arguments', () => {
        const values = compare(`fun A B helper
  Value = A + B
  return Value + Value
end`, [[2n, 3n], [1.5, 2.5], ['x', 'y'], [true, false],
            [1n], [1n, 2n, 3n], [9007199254740993n, 2n]], 4);
        expect(values[0]).toEqual({ value: '10' });
        expect(values[1]).toEqual({ value: '8' });
        expect(values[6]).toEqual({ value: '18014398509481990' });
    });

    it('preserves scalar and broadcast array behavior', () => {
        compare(`fun A helper
  Value = A + 1
  return Value * 2
end`, [[{ kind: 'array', shape: [2], items: [1n, 2n] }], [3n]], 1);
    });

    it('keeps memo cache hits outside the generated body', () => {
        compare(`memo X helper
  Value = X + 1
  return Value * 2
end`, [[3n], [3n], [4n], [4n]], 2);
    });

    it('handles zero parameters and rejects duplicate parameter names', () => {
        expect(compare('fun helper\n  return 7\nend', [[], []], 2)[0]).toEqual({ value: '7' });
        for (const scalarEntryCompilation of [false, true]) {
            const runtime = new Interpreter(undefined, { scalarEntryCompilation });
            try {
                expect(() => runtime.execute('fun X X helper\n  return X\nend'))
                    .toThrow('Duplicate function parameter X');
            } finally { runtime.dispose(); }
        }
    });

    it('retains error location and recovers call depth', () => {
        const values = compare(`fun X helper
  Value = X - 1
  return 10 // Value
end`, [[1n], [3n]], 2);
        expect(values[0]).toHaveProperty('error', expect.stringContaining('division by zero'));
        expect(values[1]).toEqual({ value: '5' });
    });

    it('rejects captured assignment collisions before execution', () => {
        const results = [false, true].map(scalarEntryCompilation => {
            let calls = 0;
            const runtime = new Interpreter(undefined, { scalarEntryCompilation,
                onScalarFunctionExecuted: () => calls++ });
            try {
                expect(() => runtime.execute(`fun X outer
  fun N helper
    Value = N + 1
    return Value
  end
  First = 1 helper
  Value = 99
  Second = 2 helper
  return First + Second + Value
end
0 outer`)).toThrow('Value is bound in an enclosing function');
                return calls;
            } finally { runtime.dispose(); }
        });
        expect(results).toEqual([0, 0]);
    });
});

it('keeps cell shapes and logical depth when called outside compiled loops', () => {
    for (const source of [`fun X helper
  Value = X + 1
  return Value * 2
end
A = array shape 2 2 with
  1 2
  3 4
end
A helper rank 0`, `fun X helper
  Value = X + 1
  return Value * 2
end
fun X outer
  return (X helper) + 1
end
2 outer`]) {
        for (const maxCallDepth of [1, 2]) {
            const results = [false, true].map(scalarEntryCompilation => {
                const runtime = new Interpreter(undefined, { scalarEntryCompilation, maxCallDepth });
                try { return runtime.execute(source); }
                catch (error) { return error instanceof RankError ? error.format() : String(error); }
                finally { runtime.dispose(); }
            });
            expect(results[1]).toEqual(results[0]);
        }
    }
});


describe('ordinary entry for local loops', () => {
    const concat = `fun A B helper
  Scale = 10
  for Scale at most B
    Scale *= 10
  end
  return A * Scale + B
end`;

    it('executes loop kernels with integer and real specializations', () => {
        const values = compare(concat, [[13n, 7n], [7n, 13n], [3n, 10n], [1.5, 2n], [0n, 0n]], 5);
        expect(values.map(value => value.value)).toEqual(['137', '713', '310', '17', '0']);
    });

    it('preserves errors in a loop and recovers for the next call', () => {
        compare(`fun X helper
  Total = 0
  for I in 0 to 2
    Total += 10 // (X - I)
  end
  return Total
end`, [[1n], [4n]], 2);
    });

    it('keeps memo hits outside loop execution', () => {
        compare(concat.replace('fun ', 'memo '), [[13n, 7n], [13n, 7n], [7n, 13n]], 2);
    });

    it('keeps writes to argument arrays on the framed path', () => {
        compare(`fun A helper
  for I in 0 till 2
    A I = I
  end
  return A 0
end`, [[{ kind: 'array', shape: [2], items: [9n, 9n] }]], 0);
    });

    it('compiles private integer containers at ordinary entry', () => {
        compare(`use algo
fun N helper
  Values = new stack
  for I in 0 till N
    Values push I
  end
  return Values len
end`, [[0n], [3n]], 2);
    });

    it('keeps local index aliases private and fresh across calls', () => {
        const values = compare(`use algo
fun N helper
  Cache = new index
  Alias = Cache
  Before = N in Alias
  Alias N = N + 1
  return Before
end`, [[0n], [4n], [2n]], 3);
        expect(values.map(value => value.value)).toEqual(['false', 'false', 'false']);
    });

    it('retains framed calls for escaping containers and noninteger payloads', () => {
        compare(`use algo
fun N helper
  Values = new stack
  Values push N
  return Values
end`, [[0n], [3n]], 0);
        compare(`use algo
fun N helper
  Cache = new index
  Cache N = "text"
  return Cache N
end`, [[0n], [3n]], 0);
    });

    it('compiles scalar index defaults without evaluating a present fallback', () => {
        const values = compare(`use algo
fun N helper
  Cache = new index
  Key = N
  Before = Cache Key default 0
  Cache Key = 7
  Found = Cache Key default (1 // 0)
  return Before + Found
end`, [[1n], [2n]], 2);
        expect(values.map(value => value.value)).toEqual(['7', '7']);
        const errors = compare(`use algo
fun N helper
  Cache = new index
  return Cache N default (1 // 0)
end`, [[1n]], 1);
        expect(errors[0]).toHaveProperty('error', expect.stringContaining('division by zero'));
    });

    it('retains defaults for missing intermediate selector expressions', () => {
        const values = compare(`use algo
fun N helper
  Cache = new index
  Keys = array 1 2
  return Cache (Keys N) default 9
end`, [[10n]], 0);
        expect(values[0]).toEqual({ value: '9' });
    });

    it('preserves the unsupported index length error', () => {
        const values = compare(`use algo
fun N helper
  Cache = new index
  Cache N = N
  return Cache len
end`, [[1n]], 0);
        expect(values[0]).toHaveProperty('error', expect.stringContaining('len expects text or a collection'));
    });

    it('preserves range errors and empty ranges with multiple parameters', () => {
        compare(`fun First X Step helper
  Total = 0
  for I in 1 to X by Step
    Total += I
  end
  return Total
end`, [[1n, 3n, 1n], [9n, 0n, 1n], [1n, 3n, 0n]], 3);
    });

    it('rechecks native bindings before entering a cached loop kernel', () => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(`use text
fun helper
  Total = 0
  for I in 1 to 3
    if "abc" "a" startswith
      Total += 1
    end
  end
  return Total
end`);
            expect(runtime.execute('helper')).toBe(3n);
            expect(calls).toBe(1);
            const original = runtime.variables.get('startswith');
            runtime.execute('fun A B replacement\n return false\nend');
            runtime.variables.set('startswith', runtime.variables.get('replacement')!);
            expect(runtime.execute('helper')).toBe(0n);
            // The replacement may compile, but the guarded helper must fall back.
            calls = 0;
            if (original) runtime.variables.set('startswith', original);
            else runtime.variables.delete('startswith');
            expect(runtime.execute('helper')).toBe(3n);
            expect(calls).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('disables cached loop entry while inspecting and resumes afterward', () => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(concat);
            const fn = runtime.variables.get('helper');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing helper');
            expect(fn.call([13n, 7n])).toBe(137n);
            const signal = new Int32Array(new SharedArrayBuffer(12));
            expect(withInterrupt(signal, () => fn.call([13n, 7n]), () => {})).toBe(137n);
            expect(calls).toBe(1);
            expect(fn.call([7n, 13n])).toBe(713n);
            expect(calls).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('checks cancellation inside a loop entered through a host call', () => {
        for (const scalarEntryCompilation of [false, true]) {
            const runtime = new Interpreter(undefined, { scalarEntryCompilation });
            try {
                runtime.execute(`fun N helper
  for N greater 0
    N += 1
  end
  return N
end`);
                const fn = runtime.variables.get('helper');
                if (!fn || !isNativeFunction(fn)) throw new Error('missing helper');
                const signal = new Int32Array(new SharedArrayBuffer(4));
                Atomics.store(signal, 0, 1);
                expect(() => withInterrupt(signal, () => fn.call([1n]))).toThrow('Interrupted');
                expect(fn.call([0n])).toBe(0n);
            } finally { runtime.dispose(); }
        }
    });
});
