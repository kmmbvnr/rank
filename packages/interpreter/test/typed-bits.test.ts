import { describe, expect, it } from 'vitest';
import { Interpreter, RankError } from '../src/index.js';

describe('typed integer bit calls', () => {
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
