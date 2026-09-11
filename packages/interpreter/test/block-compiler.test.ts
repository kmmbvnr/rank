import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import { compileBlock } from '../src/block-compiler.js';
import { MemoryIo } from './support.js';

function execute(source: string, blockCompilation: boolean) {
    const output: string[] = [];
    const io = new MemoryIo({ '/input': 'abcdef' });
    let entries = 0;
    const runtime = new Interpreter(line => output.push(line), {
        blockCompilation, io, onBlockExecuted: () => entries++,
    });
    try {
        const value = runtime.execute(source);
        return { output, value: value === undefined ? undefined : formatValue(value),
            closed: io.handles.map(h => h.closed), entries };
    } catch (error) {
        return { output, error: error instanceof RankError ? error.format() : String(error),
            closed: io.handles.map(h => h.closed), entries };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const ordinary = execute(source, false), compiled = execute(source, true);
    expect({ ...compiled, entries: 0 }).toEqual({ ...ordinary, entries: 0 });
    expect(compiled.entries).toBeGreaterThan(0);
    return compiled;
}

describe('compiled blocks', () => {
    it('runs direct commands and loop control without changing results', () => {
        expect(compare(`use ranges
Sum = 0
for I in 1 to 10
  X = I * 2
  if I equal 3
    continue
  end
  if I equal 7
    break
  end
  Sum += X
end
Sum
`).value).toBe('36');
    });

    it('resumes after calls exactly once and preserves finally', () => {
        const result = compare(`use io
fun next X
  Y = X + 1
  Y print
  return Y
end
fun work X
  try
    A = X next
    B = A next
    return B
  finally
    "closed" print
  end
end
Answer = 4 work
Answer
`);
        expect(result.value).toBe('6');
        expect(result.output).toEqual(['5', '6', 'closed']);
    });

    it('resumes generators through catch and finally', () => {
        expect(compare(`use ranges
fun values Base
  try
    for I in 0 until 2
      Value = Base + I
      yield Value
    end
    .Failure raise
  catch .Failure Error
    Value = Base + 2
    yield Value
  finally
    Last = Base + 3
    yield Last
  end
end
A = 10 values array
A
`).value).toBe('10 11 12 13');
    });

    it('jumps over fused tensor groups and then returns', () => {
        expect(compare(`use numbers
fun calculate A
  B = A * 2
  C = B + 1
  Total = C sum
  return Total + 1
end
Values = array 1 2 3
Values calculate
`).value).toBe('16');
    });

    it('preserves file cleanup and source locations after a suspended command', () => {
        const result = compare(`use io
fun open_file Name
  File = Name open
  return File
end
File = "/input" open_file
.Before raise
Unused = Unknown
`);
        expect(result.error).toContain('.Before');
        expect(result.closed).toEqual([true]);
    });

    it('prepares only reached commands', () => {
        const prepared: number[] = [];
        const stop = new Error('stop');
        const block = compileBlock(3, {
            prepare: index => { prepared.push(index); return { run: () => {
                if (index === 1) throw stop;
                return 1n;
            } }; },
            locate: error => error,
            pause: () => { throw new Error('unexpected pause'); },
        })!;
        expect(() => block({ insideFinally: false, insideGenerator: false })).toThrow(stop);
        expect(prepared).toEqual([0, 1]);
    });

    it('declines under CSP without preparing any command', () => {
        const spy = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try {
            expect(compileBlock(61, {
                prepare: () => { throw new Error('early preparation'); },
                locate: error => error,
                pause: () => { throw new Error('unexpected pause'); },
            })).toBeUndefined();
        } finally { spy.mockRestore(); }
    });
});
