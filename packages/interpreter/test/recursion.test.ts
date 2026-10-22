import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, isNativeFunction, isRankArray, isRankSequence, type RankValue } from '../src/index.js';
import { MemoryIo, run } from './support.js';

const down = `
fun N down
  if N equal 0
    return 0
  end
  return (N - 1) down + 1
end
`;

describe('stack-safe Rank calls', () => {
    it('returns through 100,000 non-tail recursive calls, including the host API', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`${down}\n100000 down`)).toBe(100000n);
        const fn = interpreter.variables.get('down');
        if (!fn || !isNativeFunction(fn)) throw new Error('expected a function');
        expect(fn.call([1000n])).toBe(1000n);
    }, 30_000);

    it('visits a chain of 100,000 vertices and accumulates subtree sizes after returning', () => {
        expect(run(`
use algo
Edges = array shape 100000 fill -1
Seen = new set
for I in 0 till 99999
  Edges I = I + 1
end
fun V Seen dfs
  if V in Seen
    return 0
  end
  Seen add V
  Size = 1
  Next = Edges V
  if Next at least 0
    Size += Next Seen dfs
  end
  return Size
end
0 Seen dfs
`)).toBe('100000');
    }, 30_000);

    it('supports mutual recursion and explicit scalar rank', () => {
        expect(run(`
fun N even
  if N equal 0
    return true
  end
  return (N - 1) odd rank 0
end
fun N odd
  if N equal 0
    return false
  end
  return (N - 1) even
end
10000 even
`)).toBe('true');
    });

    it('preserves operand order and evaluates side effects once across multiple calls', () => {
        expect(run(`
fun N exercise
  Count = record
    .value = 0
  end
  fun V Count tree
    Count .value += 1
    if V equal 0
      return Count .value
    end
    return ((V - 1) Count tree) - ((V - 1) Count tree)
  end
  Answer = N Count tree
  return array Answer (Count .value)
end
10 exercise
`)).toBe('0 2047');
    });

    it('unwinds deep returns and caught errors through finally with explicit cleanup state', () => {
        expect(run(`
fun N exercise
  Cleaned = record
    .value = 0
  end
  fun V Cleaned visit
    try
      if V equal 0
        .Leaf 7 raise
      end
      return (V - 1) Cleaned visit + 1
    catch .Leaf Error
      return Error .Value
    finally
      Cleaned .value += 1
    end
  end
  Answer = N Cleaned visit
  return array Answer (Cleaned .value)
end
5000 exercise
`)).toBe('5007 5001');
    });

    it('restores frames after an uncaught deep error and runs every finally', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        expect(() => interpreter.execute(`
use io
fun N fail
  try
    if N equal 0
      .Leaf raise
    end
    return (N - 1) fail
  finally
    N print
  end
end
1000 fail
`)).toThrowError(RankError);
        expect(lines).toEqual(Array.from({ length: 1001 }, (_, i) => String(i)));
        expect(interpreter.execute(`${down}\n1000 down`)).toBe(1000n);
        expect(() => interpreter.execute('return 1')).toThrowError('return is only valid inside a function');
    });

    it('closes files on a deep unwind', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const interpreter = new Interpreter(undefined, { io });
        expect(() => interpreter.execute(`
use io
fun N fail
  File = "/input" open
  if N equal 0
    .Leaf raise
  end
  return (N - 1) fail
end
1000 fail
`)).toThrowError(RankError);
        expect(io.handles).toHaveLength(1001);
        expect(io.handles.every(handle => handle.closed)).toBe(true);
    });

    it('resumes generators around deep calls in the correct frame', () => {
        const interpreter = new Interpreter();
        interpreter.execute(`${down}
fun N values
  yield N down
  yield (N + 1) down
end
A' = 1000 values
B' = 2000 values
`);
        const a = interpreter.variables.get('A');
        const b = interpreter.variables.get('B');
        if (!a || !b || !isRankSequence(a) || !isRankSequence(b)) throw new Error('expected sequences');
        const left = a.plan.iterate();
        const right = b.plan.iterate();
        expect(left.next().value).toBe(1000n);
        expect(right.next().value).toBe(2000n);
        expect(left.next().value).toBe(1001n);
        expect(right.next().value).toBe(2001n);
        expect(left.next().done).toBe(true);
        expect(right.next().done).toBe(true);
        interpreter.dispose();
    });

    it('raises a catchable Rank error at the configured depth and restores the budget', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 8 });
        expect(interpreter.execute(`${down}
try
  8 down
catch .RecursionLimit Error
  Error .Kind
end
`)).toEqual({ kind: 'label', name: 'RecursionLimit' });
        expect(interpreter.execute('7 down')).toBe(7n);
        expect(() => new Interpreter(undefined, { maxCallDepth: 0 }))
            .toThrowError('maxCallDepth must be a positive safe integer');
    });

    it('finishes nested finally blocks and deep calls when a generator is closed', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line), { io });
        interpreter.execute(`${down}
use io
fun N values
  File = "/input" open
  try
    try
      yield N
    finally
      (1000 down) print
      yield 99
      "inner" print
    end
  finally
    "outer" print
  end
end
Values' = 1 values
`);
        const values = interpreter.variables.get('Values');
        if (!values || !isRankSequence(values)) throw new Error('expected a sequence');
        const iterator = values.plan.iterate();
        expect(iterator.next().value).toBe(1n);
        iterator.return?.();
        expect(lines).toEqual(['1000', 'inner', 'outer']);
        expect(io.handles[0].closed).toBe(true);
        interpreter.dispose();
    });

    it('uses the execution stack for imported functions and propagates the depth option', () => {
        const interpreter = new Interpreter(undefined, {
            loadModule: () => ({ id: 'down.ra', source: down }),
            maxCallDepth: 2000,
        });
        expect(interpreter.execute('use "down.ra" as D\n1000 D.down')).toBe(1000n);
        expect(() => interpreter.execute('2000 D.down')).toThrowError('function call depth exceeds 2000');
        expect(interpreter.execute('1000 D.down')).toBe(1000n);
    });

    it('reports nested synchronous lazy callbacks as Rank errors', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`
fun N down
  if N equal 0
    return 0
  end
  Values = (array (N - 1)) down rank 0
  return (Values 0) + 1
end
try
  10000 down
catch .RecursionLimit Error
  Error .Kind
end
`)).toEqual({ kind: 'label', name: 'RecursionLimit' });
        expect(interpreter.execute('1 + 2')).toBe(3n);
    });

    it.each(['A', "A'"])('traverses deeply nested returned values without host recursion (%s)', parameter => {
        let value: RankValue = 1n;
        for (let i = 0; i < 10000; i += 1) value = { kind: 'array', shape: [1], items: [value] };
        const interpreter = new Interpreter();
        interpreter.variables.set('Data', value);
        let result = interpreter.execute(`fun ${parameter} identity\n  return A\nend\nData identity`)!;
        if (parameter === "A'") expect(result === value).toBe(true);
        let depth = 0;
        while (isRankArray(result)) { depth++; result = result.items[0]; }
        expect(depth).toBe(10000);
        expect(result).toBe(1n);
        expect(interpreter.variables.get('Data') === value).toBe(true);
        interpreter.dispose();
    });

    it.each([
        'Item = record\n  .value = (N - 1) down + 1\nend',
        'Item = record\n  .value = 0\nend\nItem .value = (N - 1) down + 1',
    ])('suspends recursive record fields: %s', body => {
        expect(run(`
fun N down
  if N equal 0
    return 0
  end
  ${body}
  return Item .value
end
1000 down
`)).toBe('1000');
    });

    it('switches cached applications between immediate and suspended function values', () => {
        expect(run(`${down}
fun N increment
  return N + 1
end
f = increment
fun N wrapper
  Value = N f
  Value += 1
  return Value
end
A = 10 wrapper
f = down
B = 1000 wrapper
f = increment
C = 10 wrapper
array A B C
`)).toBe('12 1001 12');
    });

    it('continues a postfix application after suspension without repeating effects', () => {
        expect(run(`${down}
fun N exercise
  Count = record
    .value = 0
  end
  fun X Count tick
    Count .value += 1
    return X
  end
  fun X increment
    return X + 1
  end
  Answer = N Count tick down increment Count tick
  return array Answer (Count .value)
end
1000 exercise
`)).toBe('1001 2');
    });

    it('does not start synchronous generator commands until iteration begins', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        interpreter.execute(`
use io
fun N values
  N print
  yield N
end
Values' = 7 values
`);
        expect(lines).toEqual([]);
        const value = interpreter.variables.get('Values');
        if (!value || !isRankSequence(value)) throw new Error('expected a sequence');
        const iterator = value.plan.iterate();
        expect(lines).toEqual([]);
        expect(iterator.next().value).toBe(7n);
        expect(lines).toEqual(['7']);
        iterator.return?.();
        interpreter.dispose();
    });

    it('checks the call budget and transfers files in direct return functions', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const interpreter = new Interpreter(undefined, { io, maxCallDepth: 1 });
        expect(() => interpreter.execute(`
fun X identity
  return X
end
fun N outer
  return (N identity) + 0
end
1 outer
`)).toThrowError('function call depth exceeds 1');
        expect(interpreter.execute(`
use io
fun Path openfile
  File = Path open
  return File
end
File = "/input" openfile
Copy = File identity
Copy size
`)).toBe(4n);
        expect(io.handles[0].closed).toBe(true);
    });

    it('keeps host stack failures catchable when a native call completes synchronously', () => {
        const interpreter = new Interpreter();
        interpreter.variables.set('overflow', {
            kind: 'function', name: 'overflow', arities: [1], monadicRank: 'all',
            call() { throw new RangeError('Maximum call stack size exceeded'); },
        });
        expect(interpreter.execute(`
try
  1 overflow
catch .RecursionLimit Error
  Error .Kind
end
`)).toEqual({ kind: 'label', name: 'RecursionLimit' });
    });
});
