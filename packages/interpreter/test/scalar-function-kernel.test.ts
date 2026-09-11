import { describe, expect, it, vi } from 'vitest';
import { isFunctionStatement } from 'rank-language';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';
import { Interpreter, RankError, formatValue, parse } from '../src/index.js';

function run(source: string, enabled: boolean, module?: string) {
    let calls = 0;
    const runtime = new Interpreter(undefined, {
        scalarFunctionCompilation: enabled,
        onScalarFunctionExecuted: () => calls++,
        loadModule: module ? () => ({ id: '/virtual/helper.ra', source: module }) : undefined,
    });
    try {
        const value = runtime.execute(source);
        return { value: value === undefined ? undefined : formatValue(value), calls };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), calls };
    } finally { runtime.dispose(); }
}
function compare(source: string, module?: string) {
    const prior = run(source, false, module), compiled = run(source, true, module);
    expect({ ...compiled, calls: 0 }).toEqual({ ...prior, calls: 0 });
    return compiled;
}

describe('compiled scalar function bodies', () => {
    it.each([['-13', '5'], ['13', '-5'], ['-13', '-5'], ['9007199254740993', '7']])(
        'preserves floor division and remainder for %s / %s', (a, b) => {
            expect(compare(`use ranges
fun helper A B
  Q = A // B
  R = A % B
  return Q * 10 + R
end
Result = 0
for I in 1 to 1
  Result = (${a}) (${b}) helper
end
Result`).calls).toBe(1);
        });

    it('keeps local values independent from caller names', () => {
        expect(compare(`use ranges
fun helper X
  Value = X + 2
  Value *= 3
  return Value
end
Value = 99
Result = 0
for I in 1 to 2
  Result += I helper
end
array Result Value`)).toMatchObject({ value: '21 99', calls: 2 });
    });

    it('executes boolean locals, compounds and elif branches', () => {
        expect(compare(`use ranges
fun helper X
  Good = X greater 0
  Good and= X less 4
  if X less 0
    return false
  elif Good
    return true
  else
    return false
  end
end
Count = 0
for I in -1 to 5
  if I helper
    Count += 1
  end
end
Count`)).toMatchObject({ value: '3', calls: 7 });
    });

    it('preserves eager operand errors in boolean expressions', () => {
        const result = compare(`use ranges
fun helper X
  Good = false and (1 // X greater 0)
  return Good
end
for I in 0 to 0
  Result = I helper
end`);
        expect(result).toHaveProperty('error');
        expect(result.calls).toBe(1);
    });

    it('preserves the existing last duplicate parameter binding', () => {
        expect(compare(`use ranges
fun helper X X
  return X
end
Result = 0
for I in 1 to 1
  Result = 1 2 helper
end
Result`)).toMatchObject({ value: '2', calls: 1 });
    });

    it('uses the owning interpreter for an imported function', () => {
        expect(compare(`use "helper"
use ranges
Result = 0
for I in 1 to 3
  Result += I helper
end
Result`, `fun helper X
  Value = X + 1
  return Value * 2
end`)).toMatchObject({ value: '18', calls: 3 });
    });

    it('retains the imported function source location on failure', () => {
        const result = compare(`use "helper"
use ranges
for I in 1 to 1
  Result = I helper
end`, `fun helper X
  Value = X - 1
  return 1 // Value
end`);
        expect(result).toHaveProperty('error', expect.stringContaining('/virtual/helper.ra:3:'));
        expect(result.calls).toBe(1);
    });
});


it('declines generated function code when CSP blocks Function', () => {
    const statement = parse('fun helper X\n  return X + 1\nend').statements[0];
    if (!isFunctionStatement(statement)) throw new Error('expected function');
    const blocked = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
    try { expect(compileScalarFunction(statement)).toBeUndefined(); }
    finally { blocked.mockRestore(); }
});
