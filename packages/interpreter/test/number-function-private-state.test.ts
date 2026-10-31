import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { RankDeque } from '../src/containers.js';
import { withInterrupt } from '../src/interrupt.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter(() => {}, options);
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { observation: { value: value === undefined ? undefined : formatValue(value) }, diagnostics };
    } catch (error) {
        return { observation: { error: error instanceof RankError ? error.format() : String(error) }, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source);
    expect(result.observation).toEqual(execute(source, { compilation: false }).observation);
    expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    return result;
}
function linked(source: string, call: string) {
    return `${source}\nResult = 0\nfor Once in 1 to 1\n  Result = ${call}\nend\nResult`;
}
const queue = `use algo
use sequences
fun N visit
  A = array shape (N + 1) fill 0
  Q = new queue
  Q push 0
  Total = 0
  for X I in Q
    A X = X * X
    Total += A X + I
    if X less N
      Q push (X + 1)
    end
  end
  return Total + (Q len)
end`;

describe('checked Number functions with private integer state', () => {
    it('iterates a live queue with ordinals and keeps all storage private', () => {
        const result = compare(`${queue}\n5 visit`);
        expect(result.observation.value).toBe('76');
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(result.diagnostics.numberFunctionFallbacks).toBe(0);
    });

    it('uses the same Number variant after standalone preparation and linked calls', () => {
        const result = compare(`${queue}
Warm = 3 visit
Answer = 0
for N in 1 to 5
  Answer += N visit
end
Answer`);
        expect(result.diagnostics.numberFunctions).toBeGreaterThanOrEqual(6);
    });

    it('replays wide array stores and return values exactly', () => {
        const result = compare(linked(`fun N build
  A = array shape 2 fill 0
  A 0 = N * N
  A 1 = A 0 + 1
  return A 1
end`, '9007199254740991 build'));
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    });

    it('replays a wide queue element before it can be rounded', () => {
        const result = compare(`use algo
fun N build
  Q = new queue
  Q push (N * N)
  Total = 0
  for X in Q
    Total += X
  end
  return Total
end
9007199254740991 build`);
        expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    });

    it.each(['-1', '3'])('retains canonical index errors or negative reads for index %s', index => {
        const result = compare(linked(`fun N build
  A = array shape 3 fill 7
  A 0 = N
  return A (${index})
end`, '2 build'));
        expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    });

    it('retains write error order before evaluating its right side', () => {
        const result = compare(linked(`fun N build
  A = array shape 2 fill 0
  A N = 1 // 0
  return 1
end`, '3 build'));
        expect(result.observation.error).toBeDefined();
        expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    });

    it('retains dimension errors, empty arrays and metadata', () => {
        for (const n of [-1, 0, 3]) {
            const result = compare(`use sequences
fun N size
  A = array shape N fill 7
  return A len
end
${n} size`);
            if (n >= 0) expect(result.observation.value).toBe(String(n));
        }
    });

    it('keeps negative exclusive range endpoints exclusive', () => {
        const result = compare(`use algo
fun N count
  Q = new queue
  Total = 0
  for I in N till 0 by -1
    Q push I
    Total += 1
  end
  return Total
end
3 count`);
        expect(result.observation.value).toBe('3');
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
    });

    it.each(['mod', '//'])('preserves signed compound %s in default Number preparation', operation => {
        const result = compare(`fun N calculate
  Value = N
  Value ${operation}= 2
  return Value
end
(-3) calculate`);
        expect(result.observation.value).toBe(operation === 'mod' ? '1' : '-2');
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
    });

    it('keeps the range cursor independent of iteration binding assignments', () => {
        const result = compare(`use algo
fun N count
  Q = new queue
  for I in 1 to 3
    Q push I
    I = 100
  end
  Total = 0
  for X in Q
    Total += X
  end
  return Total
end
9 count`);
        expect(result.observation.value).toBe('6');
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
    });

    it('keeps queue elements independent of iteration binding writes', () => {
        const result = compare(`use algo
fun N count
  Q = new queue
  Q push 1
  Q push 2
  Total = 0
  for X in Q
    X += 10
    Total += X
  end
  return Total
end
9 count`);
        expect(result.observation.value).toBe('23');
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
    });

    it('keeps source cell writes live during private array iteration', () => {
        const result = compare(linked(`fun N count
  A = array shape 3 fill 1
  A 1 = 2
  A 2 = 3
  Total = 0
  for X in A
    Total += X
    A 2 = 99
  end
  return Total + (A 2)
end`, '0 count'));
        expect(result.observation.value).toBe('201');
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
    });

    it('retains ordinary alias binding boundaries during live array iteration', () => {
        const result = compare(linked(`fun N count
  A = array shape 3 fill 1
  A 1 = 2
  A 2 = 3
  Alias = A
  Total = 0
  for X in A
    Total += X
    A 2 = 99
  end
  return Total + (Alias 2)
end`, '0 count'));
        expect(result.observation.value).toBe('9');
    });

    it('does not mistake an array slice for an induction range', () => {
        const result = compare(`fun N count
  A = array shape 3 fill 7
  Total = 0
  for X in A (0 till 2)
    Total += X
  end
  return Total
end
3 count`);
        expect(result.observation.value).toBe('14');
    });

    it('snapshots the receiver while allowing a queue slot to be rebound', () => {
        const result = compare(`use algo
fun N count
  Q = new queue
  Q push 1
  Q push 2
  Total = 0
  for X in Q
    Q = new queue
    Q push 99
    Total += X
  end
  return Total
end
0 count`);
        expect(result.observation.value).toBe('3');
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
    });

    it.each([
        'Alias = A\n  Alias 0 = 9',
        'A = array 4 5',
    ])('declines storage aliases or non-constructor rebinding: %s', mutation => {
        const result = compare(`fun N count
  A = array shape 2 fill 0
  ${mutation}
  return A 0
end
1 count`);
        expect(result.diagnostics.numberFunctions).toBe(0);
    });

    it('keeps escaping arrays and external array arguments on their original path', () => {
        const result = compare(`fun N build
  A = array shape 2 fill N
  A 0 = 9
  return A
end
2 build`);
        expect(result.diagnostics.numberFunctions).toBe(0);
        compare(`fun A total\n  A 0 = 8\n  return A 0\nend\n(array 1 2) total`);
    });

    it('does not bypass overridden native queue methods', () => {
        const push = RankDeque.prototype.push;
        const spy = vi.spyOn(RankDeque.prototype, 'push').mockImplementation(function (this: RankDeque, value) {
            return push.call(this, value);
        });
        try {
            const result = compare(`${queue}\n5 visit`);
            expect(spy).toHaveBeenCalled();
            expect(result.diagnostics.numberFunctions).toBe(0);
        } finally { spy.mockRestore(); }
    });

    it('keeps opaque host polling on the observable path', () => {
        const signal = { length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {} };
        const result = withInterrupt(signal, () => compare(`${queue}\n5 visit`));
        expect(result.diagnostics.numberFunctions).toBe(0);
    });
});
