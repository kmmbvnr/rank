import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { withInterrupt } from '../src/interrupt.js';

function compare(source: string, inputs: string[], expected: unknown[]) {
    for (const compiled of [false, true]) {
        let calls = 0;
        const runtime = new Interpreter(undefined, { compilation: compiled,
            onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(source);
            const fn = runtime.variables.get('helper');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing helper');
            expect(inputs.map(text => fn.call([text]))).toEqual(expected);
            expect(calls).toBe(compiled ? inputs.length : 0);
        } finally { runtime.dispose(); }
    }
}

describe('scalar function text iteration', () => {
    it('walks Unicode code points and evaluates the iterable once', () => {
        compare(`fun Text helper
Result = ""
for Point in Text
 Text = "changed"
 Result = Point + Result
end
return Result
end`, ['', 'a𝄞é'], ['', '́e𝄞a']);
    });

    it('keeps ordinal induction independent of body assignments and continue', () => {
        compare(`fun Text helper
Sum = 0
for Point Ord in Text
 if Point equal "x"
  continue
 end
 Sum += Ord
 Ord = 999
 if Point equal "!"
  break
 end
end
return Sum
end`, ['', '𝄞x𝄞!', 'abc'], [0n, 5n, 3n]);
    });

    it('supports ignored elements, nested loops and early returns', () => {
        compare(`fun Text helper
for # Ord in Text
 for Point in Text
  if Ord equal 1
   return Point
  end
 end
end
return "empty"
end`, ['', '𝄞a'], ['empty', '𝄞']);
    });

    it('preserves guarded native binding and errors in iterable expressions', () => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(`use bits
fun N helper
 Count = 0
 for Point in N binary
  if Point equal "1"
   Count += 1
  end
 end
 return Count
end`);
            expect(runtime.execute('13 helper')).toBe(3n);
            expect(calls).toBe(1);
            expect(() => runtime.execute('-1 helper')).toThrow('nonnegative');
            expect(runtime.execute('0 helper')).toBe(0n);
            runtime.variables.set('binary', native('replacement', 1, () => '11111'));
            expect(runtime.execute('13 helper')).toBe(5n);
        } finally { runtime.dispose(); }
    });

    it('polls cancellation during long text walks and recovers', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('fun Text helper\nCount = 0\nfor Point in Text\nCount += 1\nend\nreturn Count\nend');
            const fn = runtime.variables.get('helper');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing helper');
            const signal = new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => fn.call(['a'.repeat(10000)]))).toThrow('Interrupted');
            expect(fn.call(['𝄞'])).toBe(1n);
        } finally { runtime.dispose(); }
    });
});
