import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, formatValue, type InterpreterOptions } from '../src/index.js';
import { MemoryIo } from './support.js';

function execute(source: string, enabled: boolean, options: InterpreterOptions = {}) {
    const io = new MemoryIo({ '/input': 'abcdef' });
    const output: string[] = [];
    let entries = 0, tensors = 0;
    const runtime = new Interpreter(line => output.push(line), { io, scalarEntryCompilation: false, ...options,
        functionBodyCompilation: enabled, onFunctionBodyExecuted: () => entries++,
        onTensorKernelExecuted: () => tensors++,
    });
    try {
        const value = runtime.execute(source);
        return { value: value === undefined ? undefined : formatValue(value), output,
            closed: io.handles.map(h => h.closed), entries, tensors };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), output,
            closed: io.handles.map(h => h.closed), entries, tensors };
    } finally { runtime.dispose(); }
}
function compare(source: string, options?: InterpreterOptions) {
    const reference = execute(source, false, options), compiled = execute(source, true, options);
    expect({ ...compiled, entries: 0 }).toEqual({ ...reference, entries: 0 });
    return compiled;
}

describe('compiled function body completion', () => {
    it('keeps a function loop binder local when a global has the same name', () => {
        const result = compare('I = 99\nfun count A\n Total = 0\n for I in 0 until (A len)\n  Total += A I\n end\n return Total\nend\n(array 2 3) count\nI');
        expect(result).toMatchObject({ value: '99' });
    });

    it.each(['0', 'false', '""'])('returns %s without treating it as missing', value => {
        const result = compare(`fun answer X\n  Y = X\n  return Y\nend\n${value} answer`);
        expect(result.entries).toBeGreaterThan(0);
        expect(result).toHaveProperty('value');
    });

    it('preserves early returns and finally execution', () => {
        const result = compare(`use io
fun answer X
  try
    if X greater 0
      return X
    end
  finally
    "closed" print
  end
  return 0
end
A = 1 answer
B = -1 answer
array A B`);
        expect(result.value).toBe('1 0');
        expect(result.output).toEqual(['closed', 'closed']);
    });

    it('retains tail calls and lexical captures', () => {
        const result = compare(`fun outer Base
  fun step N
    if N equal 0
      return Base
    end
    return (N - 1) step
  end
  return 10000 step
end
7 outer`, { maxCallDepth: 2 });
        expect(result.value).toBe('7');
        expect(result.entries).toBeGreaterThan(0);
    });

    it('keeps ordinary recursion on the execution stack', () => {
        const result = compare(`fun depth N
  if N equal 0
    return 0
  end
  return 1 + ((N - 1) depth)
end
1000 depth`);
        expect(result.value).toBe('1000');
    });

    it('retains tensor fusion through the final return', () => {
        const result = compare(`use numbers
fun calculate A
  B = A * 2
  C = B + 1
  return C sum
end
Values = array 1 2 3
Values calculate`);
        expect(result.value).toBe('15');
        expect(result.tensors).toBeGreaterThan(0);
    });

    it('retains a tensor kernel starting at the terminal return itself', () => {
        const result = compare(`use numbers
fun calculate A
  return (A * A) sum
end
Values = array 1 2 3
Values calculate`);
        expect(result.value).toBe('14');
        expect(result.tensors).toBeGreaterThan(0);
    });

    it('transfers returned file ownership through terminal completion', () => {
        const result = compare(`use io
fun open_file Name
  File = Name open
  return File
end
File = "/input" open_file
Value = File position
File close
Value`);
        expect(result.value).toBe('0');
        expect(result.closed).toEqual([true]);
    });

    it('closes local files and retains errors from a suspended final expression', () => {
        const result = compare(`use io
fun fail X
  .Failure raise
  return X
end
fun perform X
  File = "/input" open
  return X fail
end
1 perform`);
        expect(result).toHaveProperty('error');
        expect(result.closed).toEqual([true]);
    });

    it.each([
        'fun f X\n  Y = X\n  return\nend\n1 f',
        'fun f X\n  Y = X\nend\n1 f',
        'fun f X\n  Y = X\n  return Missing\nend\n1 f',
    ])('keeps invalid return diagnostics', source => {
        expect(compare(source)).toHaveProperty('error');
    });

    it('falls back when code generation is unavailable', () => {
        const source = `fun f X\n${Array(62).fill('  Y = X').join('\n')}\n  return Y\nend\n1 f`;
        const spy = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try {
            const result = execute(source, true);
            expect(result.value).toBe('1');
            expect(result.entries).toBe(0);
        } finally { spy.mockRestore(); }
    });
});
