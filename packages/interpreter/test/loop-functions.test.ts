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
 fun X addOffset
  return X + Offset
 end
 10 addOffset print
end`);
        expect(result.output).toEqual(['11', '12']);
        expect(result.names).not.toContain('addOffset');
        expect(() => execute(`for R in 1 till 3
 fun X addOffset
  return X + R
 end
end
10 addOffset`)).toThrow('addOffset was assigned inside');
    });

    it('captures parameters and returns contributions from nested loops', () => {
        expect(execute(`fun Base outer
 Total = 0
 for R in 1 till 3
  Offset = Base + R
  for C in 1 till 3
   fun X addOffset
    return X + Offset + C
   end
   Total += 10 addOffset
  end
 end
 return Total
end
100 outer`).value).toBe(452n);
    });

    it('rejects escaping block and expression helpers', () => {
        for (const helper of ['fun X addOffset = X + Offset', 'fun X addOffset\n return X + Offset\nend']) {
            expect(() => execute(`saved = len
for R in 1 till 3
 Offset = R
 ${helper}
 if R equal 1
  saved = addOffset
 end
end
10 saved`)).toThrow('nested function addOffset cannot be returned, assigned, or stored');
        }
    });

    it('creates separate captured workspaces for synchronous enclosing calls', () => {
        expect(execute(`fun Base make
 Total = 0
 for R in 1 till 3
  Offset = Base + R
  fun X addOffset
   return X + Offset
  end
  Total += 1 addOffset
 end
 return Total
end
(10 make) + (20 make)`).value).toBe(70n);
    });

    it('resumes loop-local helpers after a generator yields', () => {
        const result = execute(`use sequences
fun Base values
 for R in 1 till 3
  Offset = Base + R
  fun X addOffset
   return X + Offset
  end
  yield 10 addOffset
 end
end
100 values array`);
        expect(formatValue(result.value!)).toBe('111 112');
    });

    it('rejects retaining callbacks across nested loop iterations', () => {
        for (const helper of ['fun X addOffset = X + Offset', 'fun X addOffset\n return X + Offset\nend']) {
            expect(() => execute(`leftFn = len
rightFn = len
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
(1 leftFn) + (1 rightFn)`)).toThrow('nested function addOffset cannot be returned, assigned, or stored');
        }
    });

    it('allows independent declarations with the same name in successive nested loops', () => {
        expect(execute(`Total = 0
for R in 1 till 3
 for C in 1 till 2
  fun X helper
   return X + R
  end
  Total += 10 helper
 end
 for C in 1 till 2
  fun X helper
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
 fun N descend
  if N equal 0
   return R
  end
  return N + ((N - 1) descend)
 end
 Result += 3 descend
end
Result`).value).toBe(15n);
        expect(() => execute(`for R in 1 till 3
 fun X helper
  return X + R
 end
 fun X helper = X
end`)).toThrow(/function declaration/);
    });

    it('does not hoist loop helpers before their declaration', () => {
        expect(() => execute(`for R in 1 till 3
 10 helper
 fun X helper
  return X + R
 end
end`)).toThrow(/before|unknown/);
    });

    it('keeps a called top-level function out of the loop scope', () => {
        expect(() => execute(`fun X other
 return X + Offset
end
for R in 1 till 3
 Offset = R
 fun X helper
  return X other
 end
 10 helper
end`)).toThrow('unknown name: Offset');
    });

    it('preserves all queens placements and their order', () => {
        const source = readFileSync(new URL('../../../demos/classic/queens.ra', import.meta.url), 'utf8');
        const before = source.replace(/  fun Q avail\n([\s\S]*?)  end/, '  fun Q avail = Q Dy available')
            .replace('for Row in 1 till Size', `fun Q Dy available
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
