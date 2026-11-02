import {describe, expect, it} from 'vitest';
import {Interpreter, formatValue} from '../src/index.js';

describe.each([true, false])('reference container returns (compiled=%s)', compilation => {
    it('links fresh queues without sharing invocations or replaying writes', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, {compilation,onScalarFunctionExecuted:() => calls++});
        try {
            runtime.execute(`use algo
fun N values
  Q = new queue
  for I in 1 to N
    Q push I
  end
  return Q
end
fun N total
  Q = N values
  Sum = 0
  for V in Q
    Sum += V
  end
  return Sum
end
A = 3 values
B = 3 values`);
            expect(runtime.execute('100 total')).toBe(5050n);
            expect(runtime.execute('0 total')).toBe(0n);
            runtime.execute('A push 99');
            expect(formatValue(runtime.execute('A array')!)).toBe('1 2 3 99');
            expect(formatValue(runtime.execute('B array')!)).toBe('1 2 3');
            if (compilation) expect(calls).toBeGreaterThan(2);
        } finally {runtime.dispose();}
    });

    it('returns argument aliases and keeps later domain changes observable', () => {
        const runtime = new Interpreter(() => {}, {compilation});
        try {
            runtime.execute(`use algo
fun Q identity
  return Q
end
Q = new queue
Q push 7
A = Q identity
A push 9`);
            expect(formatValue(runtime.execute('Q array')!)).toBe('7 9');
            expect(() => runtime.execute('Q push "text"')).toThrow('holds integer');
            expect(formatValue(runtime.execute('(Q identity) array')!)).toBe('7 9');
        } finally {runtime.dispose();}
    });

    it('preserves returned set/index identity and mixed-return fallback', () => {
        const runtime = new Interpreter(() => {}, {compilation});
        try {
            runtime.execute(`use algo
fun X table
  T = new index
  T 0 = X
  return T
end
fun X members
  S = new set
  S add X
  return S
end
A = 17 table
B = 19 table
S = 11 members`);
            expect(runtime.execute('A 0')).toBe(17n);
            expect(runtime.execute('B 0')).toBe(19n);
            expect(runtime.execute('11 in S')).toBe(true);
            runtime.execute(`fun X mixed
  if X
    return new queue
  end
  return 3
end`);
            expect(runtime.execute('false mixed')).toBe(3n);
        } finally {runtime.dispose();}
    });
});
