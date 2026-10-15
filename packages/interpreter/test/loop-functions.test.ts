import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

for (const compilation of [false, true]) describe(`functions in loops (compiled=${compilation})`, () => {
    const execute = (source: string) => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try { return { value: runtime.execute(source), output, names: [...runtime.variables.keys()] }; }
        finally { runtime.dispose(); }
    };

    it('captures the current loop values without leaking the function name', () => {
        const result = execute(`use io
for R in 1 till 3
 Offset = R
 fun addOffset X
  return X + Offset
 end
 10 addOffset print
end`);
        expect(result.output).toEqual(['11', '12']);
        expect(result.names).not.toContain('addOffset');
        expect(() => execute(`for R in 1 till 3
 fun addOffset X
  return X + R
 end
end
10 addOffset`)).toThrow('addOffset was assigned inside');
    });

    it('captures parameters and writes enclosing bindings in nested loops', () => {
        expect(execute(`fun outer Base
 Total = 0
 for R in 1 till 3
  Offset = Base + R
  for C in 1 till 3
   fun addOffset X
    Total += X + Offset + C
    return Total
   end
   10 addOffset
  end
 end
 return Total
end
100 outer`).value).toBe(452n);
    });

    it('keeps escaping captures alive with the same reference semantics as expression helpers', () => {
        for (const helper of ['addOffset X = X + Offset', 'fun addOffset X\n return X + Offset\nend']) {
            expect(execute(`saved X = X
for R in 1 till 3
 Offset = R
 ${helper}
 if R equal 1
  saved = addOffset
 end
end
10 saved`).value).toBe(12n);
        }
    });

    it('creates separate captured workspaces for separate enclosing calls', () => {
        expect(execute(`fun make Base
 saved X = X
 for R in 1 till 3
  Offset = Base + R
  fun addOffset X
   return X + Offset
  end
  saved = addOffset
 end
 return saved
end
leftFn = (10 make)
rightFn = (20 make)
(1 leftFn) + (1 rightFn)`).value).toBe(36n);
    });

    it('resumes loop-local helpers after a generator yields', () => {
        const result = execute(`use sequences
fun values Base
 for R in 1 till 3
  Offset = Base + R
  fun addOffset X
   return X + Offset
  end
  yield 10 addOffset
 end
end
100 values array`);
        expect(formatValue(result.value!)).toBe('111 112');
    });

    it('isolates captures when a nested loop is entered again', () => {
        for (const helper of ['addOffset X = X + Offset', 'fun addOffset X\n return X + Offset\nend']) {
            expect(execute(`leftFn X = X
rightFn X = X
for R in 1 till 3
 for C in 1 till 3
  Offset = R * 10 + C
  ${helper}
  if R equal 1
   leftFn = addOffset
  else
   rightFn = addOffset
  end
 end
end
(1 leftFn) + (1 rightFn)`).value).toBe(36n);
        }
    });

    it('allows independent declarations with the same name in successive nested loops', () => {
        expect(execute(`Total = 0
for R in 1 till 3
 for C in 1 till 2
  fun helper X
   return X + R
  end
  Total += 10 helper
 end
 for C in 1 till 2
  fun helper X
   return X + R * 2
  end
  Total += 10 helper
 end
end
Total`).value).toBe(49n);
    });

    it('supports recursion and preserves declaration constants', () => {
        expect(execute(`Result = 0
for R in 1 till 3
 fun descend N
  if N equal 0
   return R
  end
  return N + ((N - 1) descend)
 end
 Result += 3 descend
end
Result`).value).toBe(15n);
        expect(() => execute(`for R in 1 till 3
 fun helper X
  return X + R
 end
 helper X = X
end`)).toThrow(/function declaration/);
    });

    it('does not hoist loop helpers before their declaration', () => {
        expect(() => execute(`for R in 1 till 3
 10 helper
 fun helper X
  return X + R
 end
end`)).toThrow(/before|unknown/);
    });

    it('keeps a called top-level function out of the loop scope', () => {
        expect(() => execute(`fun other X
 return X + Offset
end
for R in 1 till 3
 Offset = R
 fun helper X
  return X other
 end
 10 helper
end`)).toThrow('unknown name: Offset');
    });

    it('preserves all queens placements and their order', () => {
        const source = readFileSync(new URL('../../../demos/classic/queens.ra', import.meta.url), 'utf8');
        const before = source.replace(/  fun avail Q\n([\s\S]*?)  end/, '  avail Q = Q Dy available')
            .replace('for Row in 1 till Size', `fun available Q Dy
 Mask = Cols not in Q
 Mask and= Cols not in (Q + Dy)
 Mask and= Cols not in (Q - Dy)
 return Mask
end
for Row in 1 till Size`);
        const result = execute(source + '\nStates');
        expect(formatValue(result.value!)).toBe(formatValue(execute(before + '\nStates').value!));
        expect(result.value).toMatchObject({ shape: [92, 8] });
    });
});
