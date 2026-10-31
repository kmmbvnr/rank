import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function execute(source: string, compilation: boolean) {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        const value = runtime.execute(`use sequences\n${source}`);
        return { value: value === undefined ? undefined : formatValue(value), calls };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), calls };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const compiled = execute(source, true), reference = execute(source, false);
    expect({ ...compiled, calls: 0 }).toEqual({ ...reference, calls: 0 });
    return compiled;
}
const visit = `fun N A Spare visit
  Total = 0
  Work = array shape 2 fill N
  Work 0 = A 0 + N
  if N greater 0
    Total = (N - 1) Work Spare visit
  end
  Work 1 = Work 0
  Total += Work 1
  return Total
end`;

describe('recursive functions with invocation-owned arrays', () => {
    it('keeps parent and child allocations independent and leaves the input unchanged', () => {
        const result = compare(`${visit}\nInput = array 10 20\nResult = 3 Input 0 visit\narray Result (Input 0)`);
        expect(result.value).toBe('60 10');
        expect(result.calls).toBeGreaterThanOrEqual(4);
    });

    it('keeps recursion exact above the Number safe range', () => {
        const result = compare(`${visit}\n3 (array 9007199254740993 0) 0 visit`);
        expect(result.calls).toBeGreaterThanOrEqual(4);
    });

    it.each([
        ['Work = A\n  Work 0 = N', 'argument alias'],
        ['Work = array shape 2 fill N\n  A 0 = N', 'argument write'],
        ['Work = array shape 2 fill N\n  Alias = Work\n  Alias 0 = N', 'local alias write'],
    ])('declines unsafe ownership: %s (%s)', (body) => {
        const result = compare(`fun N A Spare visit
  Total = 0
  ${body}
  if N greater 0
    Total = (N - 1) Work Spare visit
  end
  return Total + Work 0
end
3 (array 10 20) 0 visit`);
        expect(result.calls).toBe(0);
    });

    it('preserves error locations through recursive local writes', () => {
        const result = compare(`fun N A Spare visit
  Total = 0
  Work = array shape 1 fill 0
  Work N = A 0
  if N equal 0
    Total = 1 Work 0 visit
  end
  return Total
end
0 (array shape 1 fill 10) 0 visit`);
        expect(result.error).toBeDefined();
        expect(result.calls).toBeGreaterThan(0);
    });

    it.each(['array 4 5 6', 'array shape 2 3 fill 7', 'array shape 0 fill 7'])('reads stored array length without cell traversal: %s', (input) => {
        const result = compare(`fun A size\n  return A len\nend\n(${input}) size`);
        expect(result.calls).toBeGreaterThan(0);
    });

    it('iterates a stored array with ordinals inside a helper', () => {
        const result = compare(`fun N A Spare weighted
  Total = 0
  for X I in A
    Total += X * (I + 1)
  end
  if N greater 0
    Total += (N - 1) A Spare weighted
  end
  return Total
end
0 (array 4 5 6) 0 weighted`);
        expect(result.value).toBe('32');
        expect(result.calls).toBeGreaterThan(0);
    });

    it('keeps recursive ownership valid across the host-depth fallback', () => {
        const result = compare(`${visit}\n140 (array 10 20) 0 visit`);
        expect(result.error).toBeUndefined();
        expect(result.calls).toBeGreaterThan(0);
        expect(result.calls).toBeLessThan(141);
    });

    it('does not force an unused deferred stage when reading array metadata', () => {
        const result = compare(`fun X size
  Unused' = X // 0
  return X len
end
(array 4 5) size`);
        expect(result.value).toBe('2');
        expect(result.calls).toBeGreaterThan(0);
    });

    it('snapshots the loop receiver before rebinding its local slot', () => {
        const result = compare(`fun N Input Spare weighted
  A = Input
  Total = 0
  for X I in A
    A = array shape 2 fill 100
    Total += X * (I + 1)
  end
  if N greater 0
    Total += (N - 1) Input Spare weighted
  end
  return Total
end
0 (array 4 5 6) 0 weighted`);
        expect(result.value).toBe('32');
        expect(result.calls).toBeGreaterThan(0);
    });

    it('keeps lazy and failing array cells on their demand path', () => {
        compare(`fun A size\n  return A len\nend\nA = (1 to 3) // (array 1 0 1)\nA size`);
        compare(`fun A total\n  S = 0\n  for X in A\n    S += X\n  end\n  return S\nend\nA = (1 to 3) // (array 1 0 1)\nA total`);
    });
});
