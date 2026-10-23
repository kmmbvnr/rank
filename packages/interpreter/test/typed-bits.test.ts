import { describe, expect, it } from 'vitest';
import { Interpreter, RankError } from '../src/index.js';
import { native } from '../src/modules/shared.js';

describe('typed integer bit calls', () => {
    it('retains module errors and lazy branches for inlined bit operations', () => {
        const outcomes = [false, true].map(compilation => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.execute('fun A B helper\n return A B bxor\nend');
                let error: string | undefined;
                try { runtime.execute('1 2 helper'); }
                catch (failure) {
                    if (!(failure instanceof RankError)) throw failure;
                    error = failure.format();
                }
                expect(error).toContain('use bits');
                expect(runtime.execute('fun X lazy\n return true or ((X 1 bxor) equal 0)\nend\n1 lazy')).toBe(true);
                runtime.execute('use bits');
                expect(runtime.execute('1 2 helper')).toBe(3n);
                return error;
            } finally { runtime.dispose(); }
        });
        expect(outcomes[1]).toEqual(outcomes[0]);
    });

    it.each(['band', 'bor', 'bxor'])('preserves exact signed %s and rechecks replaced bindings', operation => {
        const values = [0n, -1n, 3n, (1n << 130n) + 1n, -(1n << 129n)];
        const results = [false, true].map(compilation => {
            let calls = 0;
            const runtime = new Interpreter(undefined, { compilation, onScalarFunctionExecuted: () => calls++ });
            try {
                runtime.execute(`use bits\nfun A B helper\n return A B ${operation}\nend`);
                const answers = values.flatMap(a => values.map(b => runtime.execute(`${a} ${b} helper`)));
                expect(calls).toBe(compilation ? 25 : 0);
                runtime.variables.set(operation, native('replacement', 2, () => 42n));
                expect(runtime.execute('1 2 helper')).toBe(42n);
                expect(calls).toBe(compilation ? 25 : 0);
                return answers;
            } finally { runtime.dispose(); }
        });
        expect(results[1]).toEqual(results[0]);
    });

    it('matches checked calls for large integers and retains shift errors', () => {
        const results = [false, true].map(typedNativeCalls => {
            let calls = 0;
            const runtime = new Interpreter(undefined, { typedNativeCalls,
                onScalarFunctionExecuted: () => calls++ });
            try {
                runtime.execute(`use bits
fun A B helper
  X = A B band
  Y = A B bor
  Z = A B bxor
  L = A B shl
  R = A B shr
  return array X Y Z L R
end`);
                const value = runtime.execute('9007199254740993 3 helper');
                expect(calls).toBe(1);
                const errors = ['1 -1 helper', '1.0 2 helper'].map(source => {
                    try { runtime.execute(source); throw new Error('expected failure'); }
                    catch (error) {
                        if (!(error instanceof RankError)) throw error;
                        return error.format();
                    }
                });
                return { value, errors };
            } finally { runtime.dispose(); }
        });
        expect(results[1]).toEqual(results[0]);
        expect(results[1].errors[0]).toContain('shift count must be nonnegative');
        expect(results[1].errors[1]).toContain('integer');
    });
});
