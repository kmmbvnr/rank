import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function execute(source: string, directIteration: boolean) {
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { directIteration });
    try {
        const value = runtime.execute(source);
        return { value: value === undefined ? undefined : formatValue(value), output };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), output };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = execute(source, false), direct = execute(source, true);
    expect(direct).toEqual(reference);
    return direct;
}

describe('direct scalar iteration', () => {
    it('reads array mutations and keeps the ordinal independent of its binding', () => {
        const result = compare(`A = array 1 2 3
Total = 0
for X I in A
  if I equal 0
    A 1 = 9
  end
  Total += X + I
  I = 100
end
Total`);
        expect(result.value).toBe('16');
    });

    it.each(['X', '#', 'X #', '# i', '# #'])('supports bindings %s', names => {
        expect(compare(`A = array 1 2 3
Count = 0
for ${names} in A
  Count += 1
end
Count`).value).toBe('3');
    });

    it('counts Unicode characters rather than UTF-16 units', () => {
        const result = compare(`use io
for C i in "A😀B"
  C print
  i print
end`);
        expect(result.output).toEqual(['A', '0', '😀', '1', 'B', '2']);
    });

    it('retains validation for empty sources and incompatible bindings', () => {
        expect(compare(`A = (1 until 1) array
for X i j in A
end`)).toHaveProperty('error');
        expect(compare(`A = array 1 2
X = "text"
for X in A
end`)).toHaveProperty('error');
    });

    it('retains break and continue behavior', () => {
        expect(compare(`A = array 1 2 3 4
Total = 0
for X i in A
  if i equal 1
    continue
  end
  if i equal 3
    break
  end
  Total += X
end
Total`).value).toBe('4');
    });

    it('closes a generator after the return callee finishes', () => {
        const result = compare(`use io
fun values X
  try
    yield X
    yield X + 1
  finally
    "closed" print
  end
end
fun echo X
  "callee" print
  return X
end
fun first S
  for V in S
    return V echo
  end
  return 0
end
S = 7 values
S first`);
        expect(result.value).toBe('7');
        expect(result.output).toEqual(['callee', 'closed']);
    });

    it('closes a generator on a body error', () => {
        const result = compare(`use io
fun values X
  try
    yield X
    yield X + 1
  finally
    "closed" print
  end
end
S = 7 values
for V in S
  Bad = 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.output).toEqual(['closed']);
    });

    it('preserves live queue mutation semantics', () => {
        const result = compare(`use algo
Q = new queue
Q push 1
Total = 0
for V i in Q
  Total += V + i
  if V equal 1
    Q push 2
  end
end
Total`);
        expect(result.value).toBe('4');
    });

    it('keeps ranked tensor iteration on its established path', () => {
        const result = compare(`use io
M = array shape 2 2
  1 2
  3 4
end
for V i j in M rank 0
  V print
  i print
  j print
end`);
        expect(result.output).toEqual(['1', '0', '0', '2', '0', '1', '3', '1', '0', '4', '1', '1']);
    });
});
