import { describe, expect, it } from 'vitest';
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
    it('guards each invocation and recovers after invalid arguments', () => {
        const values = compare(`fun helper A B
  Value = A + B
  return Value * 2
end`, [[2n, 3n], [1.5, 2.5], ['x', 'y'], [true, false],
            [1n], [1n, 2n, 3n], [9007199254740993n, 2n]], 2);
        expect(values[0]).toEqual({ value: '10' });
        expect(values[6]).toEqual({ value: '18014398509481990' });
    });

    it('preserves scalar and broadcast array behavior', () => {
        compare(`fun helper A
  Value = A + 1
  return Value * 2
end`, [[{ kind: 'array', shape: [2], items: [1n, 2n] }], [3n]], 1);
    });

    it('keeps memo cache hits outside the generated body', () => {
        compare(`memo helper X
  Value = X + 1
  return Value * 2
end`, [[3n], [3n], [4n], [4n]], 2);
    });

    it('handles zero parameters and duplicate parameter names', () => {
        expect(compare('fun helper\n  return 7\nend', [[], []], 2)[0]).toEqual({ value: '7' });
        expect(compare('fun helper X X\n  return X\nend', [[1n, 2n]], 1)[0]).toEqual({ value: '2' });
    });

    it('retains error location and recovers call depth', () => {
        const values = compare(`fun helper X
  Value = X - 1
  return 10 // Value
end`, [[1n], [3n]], 2);
        expect(values[0]).toHaveProperty('error', expect.stringContaining('division by zero'));
        expect(values[1]).toEqual({ value: '5' });
    });

    it('checks captured assignment collisions at every invocation', () => {
        const results = [false, true].map(scalarEntryCompilation => {
            let calls = 0;
            const runtime = new Interpreter(undefined, { scalarEntryCompilation,
                onScalarFunctionExecuted: () => calls++ });
            try {
                const value = runtime.execute(`fun outer X
  fun helper N
    Value = N + 1
    return Value
  end
  First = 1 helper
  Value = 99
  Second = 2 helper
  return First + Second + Value
end
0 outer`);
                return { value, calls };
            } finally { runtime.dispose(); }
        });
        expect(results).toEqual([{ value: 8n, calls: 0 }, { value: 8n, calls: 1 }]);
    });
});

it('keeps cell shapes and logical depth when called outside compiled loops', () => {
    for (const source of [`fun helper X
  Value = X + 1
  return Value * 2
end
A = array shape 2 2 with
  1 2
  3 4
end
A helper rank 0`, `fun helper X
  Value = X + 1
  return Value * 2
end
fun outer X
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
