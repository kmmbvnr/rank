import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function run(source: string, compilation = true) {
    let loops = 0;
    const runtime = new Interpreter(() => {}, {
        compilation, scalarEntryCompilation: false, onIntegerLoopExecuted: () => loops++,
    });
    try {
        let value: string | undefined, error: string | undefined;
        try { const result = runtime.execute(source); if (result !== undefined) value = formatValue(result); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { loops, observation: { value, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]),
        } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const candidate = run(source);
    expect(candidate.observation).toEqual(run(source, false).observation);
    return candidate;
}

describe('array-returning calls in compiled loops', () => {
    it('binds a fresh result on each iteration and reads it in the region', () => {
        const result = compare(`fun N row
 return array shape N fill N
end
Total = 0
for I in 1 to 3
 Current = I row
 Total += Current 0
end
Total`);
        expect(result.observation.value).toBe('6');
        expect(result.loops).toBe(1);
    });

    it('replaces an array input while a BigInt binary loop runs', () => {
        const result = compare(`fun A N nextrow
 return array shape 2 fill (A 0) + N
end
A = array 0 0
N = 2 ** 80
for N greater 0
 A = A N nextrow
 N //= 2
end
A 0`);
        expect(result.observation.value).toBe(String(2n ** 81n - 1n));
        expect(result.loops).toBe(1);
    });

    it('preserves a callee parameter and its returned copy after local writes', () => {
        const result = compare(`fun A N changed
 A 0 = N
 return A
end
Source = array 10 20
Current = Source
Total = 0
for I in 1 to 3
 Current = Source I changed
 Total += (Current 0) + (Source 0)
end
tuple Total Source Current`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('keeps caller writes interpreted when a returned array can retain an alias', () => {
        const result = compare(`fun A pass
 return A
end
Source = array 1 2
Saved = Source
for I in 1 to 2
 Saved = Source pass
 Source 0 = I + 10
end
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(0);
    });

    it('publishes preceding scalar assignments before a result binding fails', () => {
        const result = compare(`fun N row
 return array shape 2 fill N
end
Current = array true false
for I in 1 to 3
 Before = I
 Current = I row
 After = I
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.loops).toBe(1);
    });

    it('does not evaluate a result allocation in an empty loop', () => {
        const result = compare(`fun N row
 return array shape N fill 0
end
for I in 1 till 1
 Current = -1 row
end
42`);
        expect(result.observation.value).toBe('42');
        expect(result.loops).toBe(1);
    });

    it.each(['true', '"cell"'])('keeps the returned element domain for %s', fill => {
        const result = compare(`fun N row
 return array shape 2 fill ${fill}
end
for I in 1 to 2
 Current = I row
 Value = Current 0
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('uses the declared rank when reading a returned matrix', () => {
        const result = compare(`fun N matrix
 return array shape 2 2 fill N
end
Total = 0
for I in 1 to 3
 Current = I matrix
 Total += Current 1 1
end
Total`);
        expect(result.observation.value).toBe('6');
        expect(result.loops).toBe(1);
    });

    it('rechecks function identity when an enclosing function is called again', () => {
        const result = compare(`fun N row
 return array shape 1 fill N
end
make = row
fun N total
 Total = 0
 for I in 1 to N
  Current = I make
  Total += Current 0
 end
 return Total
end
Before = 3 total
fun N replacement
 return array shape 1 fill N + 10
end
make = replacement
After = 3 total
array Before After`);
        expect(result.observation.value).toBe('6 36');
        expect(result.loops).toBeGreaterThan(0);
    });

    it('preserves error locations and partial state when the callee fails', () => {
        const result = compare(`fun A N getrow
 return array shape 1 fill A N
end
A = array 1 2
for I in 0 to 2
 Before = I
 Current = A I getrow
 After = I
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.loops).toBe(1);
    });

    it('returns an array call directly from a compiled loop', () => {
        const result = compare(`fun N row
 return array shape 2 fill N
end
fun N outer
 for I in 1 to N
  return I row
 end
 return array 0 0
end
3 outer`);
        expect(result.observation.value).toBe('1 1');
        expect(result.loops).toBe(1);
    });
});
