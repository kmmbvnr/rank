import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function run(source: string, compilation = true) {
    let loops = 0;
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false,
        onIntegerLoopExecuted: () => loops++,
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

describe('array operations in linked function kernels', () => {
    it('refreshes a prepared writer when an earlier assignment runs again', () => {
        const result = compare(`fun N rows
 Result = array 0 0
 for J in 1 to N
  Scratch = array shape 2 fill J
  Scratch 0 += 10
  Result = Scratch
 end
 return Result
end
Current = array 0 0
for I in 1 to 3
 Current = I rows
end
Current`);
        expect(result.observation.value).toBe('13 3');
        expect(result.loops).toBe(1);
    });

    it.each(['+=', '-=', '*=', '//=', 'mod='])('preserves COW and signed arithmetic for %s', operator => {
        const result = compare(`fun A N changed
 Saved = A
 A 0 ${operator} N
 A 1 ${operator} -N
 return A
end
Source = array -11 13
Current = Source
for I in 2 to 3
 Current = Source I changed
end
tuple Source Current`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('writes full scalar matrix addresses', () => {
        const result = compare(`fun A changed
 A 1 0 += 7
 return A
end
Source = array shape 2 2 fill 1
Current = Source
for I in 1 to 2
 Current = Source changed
end
tuple Source Current`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it.each(['A (-1) 0', 'A 0 (-1)', 'A 0 9007199254740993'])('retains matrix read errors for %s', expression => {
        const result = compare(`fun A cell
 return ${expression}
end
Source = array shape 2 2 fill 1
for I in 1 to 2
 Before = I
 Value = Source cell
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.loops).toBe(1);
    });

    it.each(['A 9 += 1 // 0', 'A 0 //= 0', 'A 0 += A 9'])('preserves errors and preceding caller state: %s', write => {
        const result = compare(`fun A changed
 ${write}
 return A
end
Source = array 3 5
Current = Source
for I in 1 to 2
 Before = I
 Current = Source changed
 After = I
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.loops).toBe(1);
    });

    it.each(['take', 'drop'])('returns %s views and copies with clipped and empty counts', clause => {
        const result = compare(`use sequences
fun A N sliced
 return (A ${clause} N) copy
end
Source = array 3 5 7
Current = Source
for I in 0 to 4
 Current = Source I sliced
end
tuple Source Current`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('returns a retained slice before its parameter is changed', () => {
        const result = compare(`fun A sliced
 Saved = A take 2
 A 0 += 10
 return Saved
end
Source = array 3 5 7
Current = Source
for I in 1 to 2
 Current = Source sliced
end
tuple Source Current`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('completes a selected local array before writing it', () => {
        const result = compare(`fun A sliced
 Part = A take 2
 Part 0 += 10
 return Part
end
Source = array 3 5 7
Current = Source
for I in 1 to 2
 Current = Source sliced
end
tuple Source Current`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.value).toBe('3 5 7 13 5');
        expect(result.observation.variables).toContainEqual(['Source', '3 5 7']);
        expect(result.observation.variables).toContainEqual(['Current', '13 5']);
        expect(result.loops).toBe(1);
    });

    it('retains the row rank when copying a matrix slice', () => {
        const result = compare(`use sequences
fun A sliced
 return (A take 1) copy
end
Source = array shape 2 2 fill 3
Current = Source
Cell = 0
for I in 1 to 2
 Current = Source sliced
 Cell = Current 0 1
end
Cell`);
        expect(result.observation.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it.each(['take', 'drop'])('keeps the %s count error at the return expression', clause => {
        const result = compare(`fun A sliced
 return A ${clause} (-1)
end
Source = array 3 5
Current = Source
for I in 1 to 2
 Before = I
 Current = Source sliced
end`);
        expect(result.observation.error).toContain('expects a nonnegative integer count');
        expect(result.loops).toBe(1);
    });

    it('checks copy module availability', () => {
        const result = compare(`fun A copied
 return A copy
end
Source = array 3 5
Current = Source
for I in 1 to 2
 Current = Source copied
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.loops).toBe(0);
    });

    it('keeps rebound copy calls interpreted', () => {
        const result = compare(`fun A replacement
 return array 7 9
end
copy = replacement
fun A copied
 return A copy
end
Source = array 3 5
Current = Source
for I in 1 to 2
 Current = Source copied
end
Current`);
        expect(result.observation.value).toBe('7 9');
        expect(result.loops).toBe(0);
    });

    it('compiles the outer binary recurrence loop in Euler 324', () => {
        const source = readFileSync(new URL('../../../demos/euler/324_tower.ra', import.meta.url), 'utf8')
            .replace('5 * 10 ** 9999', '500') + '\nAnswer';
        const result = compare(source);
        expect(result.observation.value).toBe('24806056');
        expect(result.loops).toBe(1);
    });
});
