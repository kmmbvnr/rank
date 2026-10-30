import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { ownedArray } from '../src/array-storage.js';
import { isNativeFunction } from '../src/value.js';

function evaluate(source: string, compilation: boolean) {
    let calls = 0;
    const runtime = new Interpreter(undefined, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        const value = runtime.execute(source);
        return { value: value === undefined ? undefined : formatValue(value), calls };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), calls };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const ordinary = evaluate(source, false), compiled = evaluate(source, true);
    expect({ ...compiled, calls: 0 }).toEqual({ ...ordinary, calls: 0 });
    return compiled;
}

describe('finite iterators in compiled scalar functions', () => {
    it.each(['factors', 'factors unique', 'divisors', 'divisors unique'])('consumes %s with exact ordinals', operation => {
        const result = compare(`use numbers
use sequences
fun N walk
  Total = 0
  for P I in N ${operation}
    Total += P * (I + 1)
  end
  return Total
end
360 walk`);
        expect(result.error).toBeUndefined();
        expect(result.calls).toBeGreaterThan(0);
    });

    it('keeps factor multiplicities and unique observers independent', () => {
        expect(compare(`use numbers
use sequences
fun N walk
  Total = 0
  for P in N factors
    Total += P
  end
  for P in N factors unique
    Total += 100 * P
  end
  return Total
end
72 walk`)).toMatchObject({ value: '512', calls: 1 });
    });

    it('returns without demanding a hard factorization tail', () => {
        expect(compare(`use numbers
use sequences
fun N firstfactor
  for P in N factors unique
    return P
  end
  return 0
end
2000000032000000126 firstfactor`)).toMatchObject({ value: '2', calls: 1 });
    });

    it('handles empty sources, continue and break', () => {
        expect(compare(`use numbers
fun N walk
  Total = 0
  for P in N factors
    if P equal 2
      continue
    end
    Total += P
    break
  end
  return Total
end
(1 walk) + (72 walk)`)).toMatchObject({ value: '3', calls: 2 });
    });

    it.each(['array -8 -4 0 +4 8', 'array -1.5 +2.5', 'array true false true', 'array "a" "b"'])('iterates %s inside a helper', literal => {
        const result = compare(`fun N walk
  Total = 0
  for P I in ${literal}
    Total += I + 1
  end
  return Total
end
0 walk`);
        expect(result.error).toBeUndefined();
        expect(result.calls).toBe(1);
    });

    it('preserves literal signs when returning a vector too', () => {
        expect(compare(`fun N values
  return array -8 -4 0 +4 8
end
0 values`)).toMatchObject({ value: '-8 -4 0 4 8', calls: 1 });
    });

    it('keeps element domains through unique', () => {
        expect(compare(`use sequences
fun N walk
  Total = 0
  for P in (array true false true) unique
    if P
      Total += 1
    end
  end
  return Total
end
0 walk`)).toMatchObject({ value: '1', calls: 1 });
    });

    it('does not evaluate an iterator behind a false branch', () => {
        expect(compare(`use numbers
fun N walk
  if N greater 0
    for P in 0 factors
      return P
    end
  end
  return 7
end
0 walk`)).toMatchObject({ value: '7', calls: 1 });
    });

    it('keeps unopened modules behind a false branch untouched', () => {
        expect(compare(`fun N walk
  if N greater 0
    for P in N factors
      return P
    end
  end
  return 7
end
0 walk`)).toMatchObject({ value: '7', calls: 0 });
    });

    it.each(['0 factors', '-1 factors', '0 divisors'])('preserves domain errors for %s', source => {
        expect(compare(`use numbers
fun N walk
  for P in ${source}
    return P
  end
  return 0
end
1 walk`).error).toBeDefined();
    });

    it.each(['factors', 'unique'])('rechecks a cached %s binding and native implementation', name => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        const source = `use numbers
use sequences
fun N walk
  Total = 0
  for P in N factors unique
    Total += P
  end
  return Total
end`;
        try {
            runtime.execute(source);
            expect(runtime.execute('12 walk')).toBe(5n);
            expect(calls).toBeGreaterThan(0);
            const value = runtime.execute(name)!;
            expect(isNativeFunction(value)).toBe(true);
            if (!isNativeFunction(value)) throw new Error('expected native');
            const original = value.call;
            let replacements = 0;
            const mutable = value as { call: typeof value.call };
            mutable.call = () => { replacements++; return ownedArray([11n], [1], true); };
            expect(runtime.execute('12 walk')).toBe(11n);
            expect(replacements).toBeGreaterThan(0);
            mutable.call = original;
            runtime.variables.set(name, native('replacement', 1, () => ownedArray([13n], [1], true)));
            expect(runtime.execute('12 walk')).toBe(13n);
        } finally { runtime.dispose(); }
    });

    it('compiles the unchanged full Euler 263 search and retains its golden answer', () => {
        const diagnostics = new RuntimeDiagnostics();
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            const source = readFileSync(new URL('../../../demos/euler/263_engineersdream.ra', import.meta.url), 'utf8');
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(2039506520n);
            expect(runtime.variables.get('Found')).toBe(4n);
            expect(calls).toBeGreaterThan(0);
            expect(diagnostics.compiledLoops).toBeGreaterThan(0);
            expect(diagnostics.compilerRejections).toEqual([]);
        } finally { runtime.dispose(); }
    }, 30_000);

    it('keeps lexical replacements of native iterator operations ordinary', () => {
        expect(compare(`fun N factors
  return array N
end
fun N walk
  Total = 0
  for P in N factors
    Total += P
  end
  return Total
end
7 walk`)).toMatchObject({ value: '7' });
    });

    it('handles an empty literal without binding its loop variable', () => {
        expect(compare(`fun N walk
  for P in array shape 0 fill 0
    return P
  end
  return 7
end
0 walk`)).toMatchObject({ value: '7', calls: 1 });
    });

    it('retains the scope error for an existing outer iteration binding', () => {
        expect(compare(`use numbers
P = 99
fun N walk
  Total = 0
  for P in N factors
    Total += P
  end
  return Total
end
Answer = 12 walk
array Answer P`).error).toContain('P is already bound outside this block');
    });
});
