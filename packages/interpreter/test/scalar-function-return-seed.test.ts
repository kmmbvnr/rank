import { describe, expect, it } from 'vitest';
import { Interpreter, RankError } from '../src/index.js';

function run(source: string, compilation: boolean) {
    let calls = 0;
    const runtime = new Interpreter(() => {}, {
        compilation, onScalarFunctionExecuted: () => calls++,
    });
    try {
        return { value: runtime.execute(source), calls };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), calls };
    } finally { runtime.dispose(); }
}

function recursive(initial: string, tail = '') {
    return `fun N visit
  Result = ${initial}
  for J in 1 till N
    Result += J visit
  end
  ${tail}
  return Result
end
6 visit`;
}

describe('recursive return types from closed local initializers', () => {
    it.each([
        ['1', 32n], ['1 + 0', 32n], ['0.5', 16],
    ])('compiles a returned accumulator initialized with %s', (initial, expected) => {
        const source = recursive(initial);
        expect(run(source, false)).toEqual({ value: expected, calls: 0 });
        const result = run(source, true);
        expect(result.value).toBe(expected);
        expect(result.calls).toBeGreaterThan(1);
    });

    it('still checks assignments against the inferred return candidate', () => {
        const source = recursive('1', 'Result = 1.5');
        const reference = run(source, false), compiled = run(source, true);
        expect(reference.error).toContain('Result has type integer and cannot receive real');
        expect(compiled).toEqual(reference);
    });

    it('does not execute a closed initializer during proof or when the helper is unused', () => {
        const helper = recursive('1 // 0').replace('6 visit', '42');
        expect(run(helper, false)).toEqual({ value: 42n, calls: 0 });
        expect(run(helper, true)).toEqual({ value: 42n, calls: 0 });
        const source = recursive('1 // 0');
        const reference = run(source, false), compiled = run(source, true);
        expect(reference.error).toBeDefined();
        expect(compiled.error).toEqual(reference.error);
    });

    it('preserves every return check after seeding the terminal local', () => {
        const source = `fun N visit
  Result = 1
  if N equal 1
    return 0.5
  end
  for J in 1 till N
    Result += J visit
  end
  return Result
end
1 visit`;
        expect(run(source, true)).toEqual(run(source, false));
        expect(run(source, true).value).toBe(0.5);
    });

    it('does not seed from an initializer inside a conditional path', () => {
        const source = `fun N visit
  if N greater 0
    Result = 1
  end
  for J in 1 till N
    Result += J visit
  end
  return Result
end
0 visit`;
        const reference = run(source, false), compiled = run(source, true);
        expect(reference.error).toBeDefined();
        expect(compiled).toEqual(reference);
    });
});
