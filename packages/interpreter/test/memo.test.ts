import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';

describe('memo functions and explicit index caches', () => {
    it('memoizes Fibonacci with an index passed through recursive calls', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        expect(interpreter.execute(`
use algo
use io
Index = index
fun fib N Cache
  if N in Cache
    return Cache N
  end
  N print
  if N less 2
    Value = N
  else
    Value = ((N - 1) Cache fib) + ((N - 2) Cache fib)
  end
  Cache N = Value
  return Value
end
30 Index fib
`)).toBe(832040n);
        expect(calls).toHaveLength(31);
        expect(interpreter.execute('Index 30')).toBe(832040n);
        expect(interpreter.execute('30 Index fib')).toBe(832040n);
        expect(calls).toHaveLength(31);
    });

    it('shares named indices by reference and supports tuple keys and compound writes', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`
use algo
Index = index
Alias = Index
fun store Cache K V
  Cache K = V
  Cache K += 1
  return 0
end
X = Index 7 99 store
Alias 7
`)).toBe(100n);
        expect(interpreter.execute(`
Index "a|text:b" "c" = 1
Alias "a" "b|text:c" = 2
Index "a|text:b" "c"
`)).toBe(1n);
        expect(interpreter.execute('Alias "a" "b|text:c"')).toBe(2n);
        expect(() => interpreter.execute('Index 8 += 1')).toThrowError('index key not found');
    });

    it('keeps implicit index reads and writes local even when an outer index exists', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`
use algo
index 1 = 100
fun local N
  Before = index 1 pad -1
  index 1 = N
  return Before
end
7 local
`)).toBe(-1n);
        expect(interpreter.execute('8 local')).toBe(-1n);
        expect(interpreter.execute('index 1')).toBe(100n);
    });

    it('caches every Fibonacci state and shares the cache through aliases', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        expect(interpreter.execute(`
use io
memo fib N
  N print
  if N less 2
    return N
  end
  return ((N - 1) fib) + ((N - 2) fib)
end
30 fib
`)).toBe(832040n);
        expect(calls).toHaveLength(31);
        expect(interpreter.execute('F = fib\n30 F')).toBe(832040n);
        expect(calls).toHaveLength(31);
        expect(interpreter.execute('31 fib')).toBe(1346269n);
        expect(calls).toHaveLength(32);
    });

    it('creates fresh caches on each outer call and preserves escaped closures', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        interpreter.execute(`
use io
fun make Base
  memo value N
    N print
    return Base + N
  end
  return value
end
A = 10 make
B = 20 make
`);
        expect(interpreter.execute('5 A')).toBe(15n);
        expect(interpreter.execute('5 A')).toBe(15n);
        expect(interpreter.execute('5 B')).toBe(25n);
        expect(interpreter.execute('5 B')).toBe(25n);
        expect(calls).toEqual(['5', '5']);
        expect(interpreter.execute('A equal B')).toBe(false);
        const localCalls: string[] = [];
        const fresh = new Interpreter(line => localCalls.push(line));
        fresh.execute(`
use io
fun solve Base
  memo value N
    N print
    return Base + N
  end
  X = 5 value
  return 5 value
end
`);
        expect(fresh.execute('10 solve')).toBe(15n);
        expect(fresh.execute('20 solve')).toBe(25n);
        expect(localCalls).toEqual(['5', '5']);
    });

    it('uses complete typed argument tuples without delimiter collisions', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        interpreter.execute(`
use io
memo first A B
  A print
  return A
end
memo identity X
  X print
  return X
end
`);
        expect(interpreter.execute('"a|string:b" "c" first')).toBe('a|string:b');
        expect(interpreter.execute('"a" "b|string:c" first')).toBe('a');
        for (const source of ['0', 'false', '"0"', '.Zero', '0.5']) {
            interpreter.execute(`${source} identity`);
            interpreter.execute(`${source} identity`);
        }
        expect(calls).toHaveLength(7);
    });

    it('does not cache errors or results whose finally block fails', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        interpreter.execute(`
use io
memo fail N
  N print
  try
    return N
  finally
    .Oops raise
  end
end
`);
        for (let i = 0; i < 2; i++) expect(() => interpreter.execute('1 fail')).toThrowError('.Oops');
        expect(calls).toEqual(['1', '1']);
    });

    it('runs deep memo recursion without using the JavaScript call stack', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`
memo down N
  if N equal 0
    return 0
  end
  return ((N - 1) down) + 1
end
100000 down
`)).toBe(100000n);
        expect(interpreter.execute('99999 down')).toBe(99999n);
    }, 30_000);

    it('does not bypass cache writes for tail-position memo calls', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        interpreter.execute(`
use io
memo down N
  N print
  if N equal 0
    return 0
  end
  return (N - 1) down
end
fun forward N
  return N down
end
`);
        expect(interpreter.execute('20 forward')).toBe(0n);
        expect(calls).toHaveLength(21);
        expect(interpreter.execute('19 down')).toBe(0n);
        expect(calls).toHaveLength(21);
    });

    it('supports mutual recursion and a memo body tail-calling an ordinary function', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        interpreter.execute(`
use io
memo even N
  N print
  if N equal 0
    return true
  end
  return (N - 1) odd
end
memo odd N
  N print
  if N equal 0
    return false
  end
  return (N - 1) even
end
fun add N
  return N + 1
end
memo forward N
  N print
  return N add
end
`);
        expect(interpreter.execute('20 even')).toBe(true);
        expect(interpreter.execute('19 odd')).toBe(true);
        expect(calls).toHaveLength(21);
        expect(interpreter.execute('5 forward')).toBe(6n);
        expect(interpreter.execute('5 forward')).toBe(6n);
        expect(calls).toHaveLength(22);
    });

    it('rejects generators and mutable arguments or results', () => {
        const interpreter = new Interpreter();
        expect(() => interpreter.execute('memo values N\n yield N\nend')).toThrowError('memo functions cannot yield');
        interpreter.execute('memo identity X\n return X\nend');
        expect(() => interpreter.execute('(array 1 2) identity')).toThrowError('memo arguments and results must be scalar values');
        interpreter.execute('memo values N\n return array N\nend');
        expect(() => interpreter.execute('1 values')).toThrowError('memo arguments and results must be scalar values');
        expect(interpreter.execute('2 identity')).toBe(2n);
    });

    it('checks arity on the host path and gives a redefinition a fresh cache', () => {
        const interpreter = new Interpreter();
        interpreter.execute('memo identity X\n return X\nend');
        const fn = interpreter.variables.get('identity')!;
        if (!isNativeFunction(fn)) throw new Error('expected function');
        expect(fn.call([2n])).toBe(2n);
        expect(fn.call([2])).toBe(2);
        expect(fn.call([-0])).toBe(-0);
        expect(fn.call([0])).toBe(0);
        expect(() => fn.call([])).toThrowError('expects 1 arguments');
        expect(() => fn.call([2n, 3n])).toThrowError('expects 1 arguments');
        expect(interpreter.execute('memo identity X\n return X + 1\nend\n2 identity')).toBe(3n);
        expect(fn.call([2n])).toBe(2n);
    });
});
