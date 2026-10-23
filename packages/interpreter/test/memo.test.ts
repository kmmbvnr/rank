import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction } from '../src/index.js';

describe('memo functions and explicit index caches', () => {
    it('memoizes Fibonacci with an index passed through recursive calls', () => {
        const calls: string[] = [];
        const interpreter = new Interpreter(line => calls.push(line));
        expect(interpreter.execute(`
use algo
use io
Index = new index
fun N fib Cache
  if N in Cache
    return Cache N
  end
  N print
  Value = 0
  if N less 2
    Value = N
  else
    Value = ((N - 1) fib Cache) + ((N - 2) fib Cache)
  end
  Cache N = Value
  return Value
end
30 fib Index
`)).toBe(832040n);
        expect(calls).toHaveLength(31);
        expect(interpreter.execute('Index 30')).toBe(832040n);
        expect(interpreter.execute('30 fib Index')).toBe(832040n);
        expect(calls).toHaveLength(31);
    });

    it('shares named indices by reference and supports tuple keys and compound writes', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`
use algo
Index = new index
Alias = Index
fun Cache K V store
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

    it('keeps a function-local index apart from a top-level one with the same name', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`
use algo
Cache = new index
Cache 1 = 100
fun N local
  Cache = new index
  Before = Cache 1 default -1
  Cache 1 = N
  return Before
end
7 local
`)).toBe(-1n);
        expect(interpreter.execute('8 local')).toBe(-1n);
        expect(interpreter.execute('Cache 1')).toBe(100n);
    });

    it('caches every Fibonacci state and shares the cache through aliases', () => {
        const diagnostics = new RuntimeDiagnostics();
        const interpreter = new Interpreter();
        const execute = (source: string) => diagnostics.run(() => interpreter.execute(source));
        expect(execute(`
use io
memo N fib
  if N less 2
    return N
  end
  return ((N - 1) fib) + ((N - 2) fib)
end
30 fib
`)).toBe(832040n);
        expect(diagnostics.memoMisses).toBe(31);
        expect(execute('f = fib\n30 f')).toBe(832040n);
        expect(diagnostics.memoMisses).toBe(31);
        expect(execute('31 fib')).toBe(1346269n);
        expect(diagnostics.memoMisses).toBe(32);
    });

    it('creates fresh local caches on each enclosing call', () => {
        const diagnostics = new RuntimeDiagnostics();
        const interpreter = new Interpreter();
        const execute = (source: string) => diagnostics.run(() => interpreter.execute(source));
        execute(`
fun Base solve
  memo N value
    return N + 1
  end
  X = Base value
  return Base value
end
`);
        expect(execute('10 solve')).toBe(11n);
        expect(execute('10 solve')).toBe(11n);
        expect(diagnostics.memoMisses).toBe(2);
        expect(diagnostics.memoHits).toBe(2);
        interpreter.dispose();
    });

    it('uses complete typed argument tuples without delimiter collisions', () => {
        const diagnostics = new RuntimeDiagnostics();
        const interpreter = new Interpreter();
        const execute = (source: string) => diagnostics.run(() => interpreter.execute(source));
        execute(`
use io
memo A first B
  return A
end
memo X identity
  return X
end
`);
        expect(execute('"a|string:b" first "c"')).toBe('a|string:b');
        expect(execute('"a" first "b|string:c"')).toBe('a');
        for (const source of ['0', 'false', '"0"', '.Zero', '0.5']) {
            execute(`${source} identity`);
            execute(`${source} identity`);
        }
        expect(diagnostics.memoMisses).toBe(7);
    });

    it('does not cache errors or results whose finally block fails', () => {
        const diagnostics = new RuntimeDiagnostics();
        const interpreter = new Interpreter();
        const execute = (source: string) => diagnostics.run(() => interpreter.execute(source));
        execute(`
use io
memo N fail
  try
    return N
  finally
    .Oops raise
  end
end
`);
        for (let i = 0; i < 2; i++) expect(() => execute('1 fail')).toThrowError('.Oops');
        expect(diagnostics.memoMisses).toBe(2);
    });

    it('keeps primitive unary keys separate from tagged text and labels', () => {
        const diagnostics = new RuntimeDiagnostics();
        const interpreter = new Interpreter();
        const execute = (source: string) => diagnostics.run(() => interpreter.execute(source));
        execute('use io\nmemo X identity\n return X\nend');
        const fn = interpreter.variables.get('identity')!;
        if (!isNativeFunction(fn)) throw new Error('expected function');
        for (const value of [2n, 2, -0, 0, NaN, Infinity, -Infinity, false, true,
            '2', 'bigint:2', 'number:-0', 'label:Zero', 'date:2026-10-10']) {
            expect(diagnostics.run(() => fn.call([value]))).toBe(value);
            expect(diagnostics.run(() => fn.call([value]))).toBe(value);
        }
        execute('.Zero identity\n.Zero identity');
        expect(diagnostics.run(() => fn.call([{ kind: 'label', name: 'Zero' }]))).toEqual({ kind: 'label', name: 'Zero' });
        const date = { kind: 'date', year: 2026, month: 10, day: 10 } as const;
        expect(diagnostics.run(() => fn.call([date]))).toEqual(date);
        expect(diagnostics.run(() => fn.call([{ ...date }]))).toEqual(date);
        expect(diagnostics.memoMisses).toBe(16);
        // A cached unary value must not hide an invalid host-call arity.
        expect(() => fn.call([])).toThrowError('expects 1 arguments');
        expect(() => fn.call([2n, 3n])).toThrowError('expects 1 arguments');
        interpreter.dispose();
    });

    it('runs deep memo JavaScript recursion without using the call stack', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute(`
memo N down
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
        const diagnostics = new RuntimeDiagnostics();
        const interpreter = new Interpreter();
        const execute = (source: string) => diagnostics.run(() => interpreter.execute(source));
        execute(`
use io
memo N down
  if N equal 0
    return 0
  end
  return (N - 1) down
end
fun N forward
  return N down
end
`);
        expect(execute('20 forward')).toBe(0n);
        expect(diagnostics.memoMisses).toBe(21);
        expect(execute('19 down')).toBe(0n);
        expect(diagnostics.memoMisses).toBe(21);
    });

    it('supports mutual recursion and a memo body tail-calling an ordinary function', () => {
        const diagnostics = new RuntimeDiagnostics();
        const interpreter = new Interpreter();
        const execute = (source: string) => diagnostics.run(() => interpreter.execute(source));
        execute(`
use io
memo N even
  if N equal 0
    return true
  end
  return (N - 1) odd
end
memo N odd
  if N equal 0
    return false
  end
  return (N - 1) even
end
fun N add
  return N + 1
end
memo N forward
  return N add
end
`);
        expect(execute('20 even')).toBe(true);
        expect(execute('19 odd')).toBe(true);
        expect(diagnostics.memoMisses).toBe(21);
        expect(execute('5 forward')).toBe(6n);
        expect(execute('5 forward')).toBe(6n);
        expect(diagnostics.memoMisses).toBe(22);
    });

    it('rejects generators and mutable arguments or results', () => {
        const interpreter = new Interpreter();
        expect(() => interpreter.execute('memo N values\n yield N\nend')).toThrowError('memo functions cannot yield');
        interpreter.execute('memo X identity\n return X\nend');
        expect(() => interpreter.execute('(array 1 2) identity')).toThrowError('memo arguments and results must be scalar values');
        interpreter.execute('memo N values\n return array N\nend');
        expect(() => interpreter.execute('1 values')).toThrowError('memo arguments and results must be scalar values');
        expect(interpreter.execute('2 identity')).toBe(2n);
    });

    it('checks arity on the host path and gives a redefinition a fresh cache', () => {
        const interpreter = new Interpreter();
        interpreter.execute('memo X identity\n return X\nend');
        const fn = interpreter.variables.get('identity')!;
        if (!isNativeFunction(fn)) throw new Error('expected function');
        expect(fn.call([2n])).toBe(2n);
        expect(fn.call([2])).toBe(2);
        expect(fn.call([-0])).toBe(-0);
        expect(fn.call([0])).toBe(0);
        expect(() => fn.call([])).toThrowError('expects 1 arguments');
        expect(() => fn.call([2n, 3n])).toThrowError('expects 1 arguments');
        interpreter.forgetBindings(['identity']);
        expect(interpreter.execute('memo X identity\n return X + 1\nend\n2 identity')).toBe(3n);
        expect(fn.call([2n])).toBe(2n);
    });
});
