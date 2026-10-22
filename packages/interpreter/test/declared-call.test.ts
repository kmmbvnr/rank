import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';

describe('call-shaped function declarations', () => {
    for (const keyword of ['fun', 'memo']) {
        it(`${keyword} supports inline bodies`, () => {
            expect(new Interpreter().execute(`${keyword} X inc = X + 1\n3 inc`)).toBe(4n);
        });
        it(`${keyword} binds optional words and missing defaults`, () => {
            const runtime = new Interpreter();
            runtime.execute(`${keyword} X scale .by Factor=2\n return X * Factor\nend`);
            expect(runtime.execute('3 scale')).toBe(6n);
            expect(runtime.execute('3 scale by 4')).toBe(12n);
            expect(runtime.execute('3 scale by .NA')).toBe(6n);
        });
        it(`${keyword} accepts symbolic and named function operands`, () => {
            const runtime = new Interpreter();
            runtime.execute(`${keyword} X Y fold op .with Seed=1\n return (X Y op) + Seed\nend\nfun A B combine = A * B`);
            if (keyword === 'memo') {
                expect(() => runtime.execute('2 3 fold + with 10')).toThrow(/memo arguments and results must be scalar/);
            } else {
                expect(runtime.execute('2 3 fold + with 10')).toBe(15n);
                expect(runtime.execute('2 3 fold combine')).toBe(7n);
            }
        });
    }
    it('ranks data while holding configuration fixed', () => {
        const value = new Interpreter().execute('fun X scale .by Factor=2\n return X * Factor\nend\n(array 1 2 3) scale by 4 rank 0');
        expect(value !== undefined && isRankArray(value) && value.items).toEqual([4n, 8n, 12n]);
    });
    it('rejects duplicate and out-of-order groups', () => {
        const runtime = new Interpreter();
        runtime.execute('fun X adjust .by Factor=2 .with Offset=1\n return X * Factor + Offset\nend');
        expect(() => runtime.execute('3 adjust by 2 by 3')).toThrow(/Duplicate/);
        expect(() => runtime.execute('3 adjust with 2 by 3')).toThrow(/order/);
    });
});

it('resolves signatures through imports and aliases before grouping calls', () => {
    const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'helpers.ra',
        source: 'fun X scale .by Factor=2 = X * Factor\nscaled = scale' }) });
    expect(runtime.execute('use "helpers" as helper\n3 helper.scale by 4')).toBe(12n);
    expect(runtime.execute('use "helpers"\n3 scaled by 5')).toBe(15n);
});

it('uses the closest declaration for contextual words and callback operators', () => {
    const runtime = new Interpreter();
    expect(runtime.execute(`fun X adjust .by Factor=2 = X * Factor
fun X outer
 fun X adjust op .with Seed=1 = (X Seed op)
 return X adjust + with 10
end
(3 outer) adjust by 4`)).toBe(52n);
});

it('supports keyword groups, header continuations, and right data', () => {
    const runtime = new Interpreter();
    expect(runtime.execute(`fun X adjust Y
 .if Factor=2
 .return Offset=1
 return (X + Y) * Factor + Offset
end
2 adjust 3 if 4 return 5`)).toBe(25n);
});

it('rejects interpreter-owned and duplicate words in declarations', () => {
    for (const word of ['rank', 'axis']) {
        expect(() => new Interpreter().execute(`fun X f .${word} N = X`)).toThrow(/reserved/);
    }
    expect(() => new Interpreter().execute('fun X f .by N .by M = X')).toThrow(/Duplicate function group/);
});

it.each([false, true])('runs a user-defined reduction (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    runtime.execute(`fun Values' fold op .with Seed
 Result = Seed
 for Value in Values
  if Result is .missing
   Result = Value
  else
   Result = Result Value op
  end
 end
 if Result is .missing
  .EmptyInput "fold needs a seed for empty input" raise
 end
 return Result
end`);
    expect(runtime.execute('(array 1 2 3) fold +')).toBe(6n);
    expect(runtime.execute('(array 1 2 3) fold + with .NA')).toBe(6n);
    expect(runtime.execute('(array 1 2 3) fold + with 10')).toBe(16n);
    expect(runtime.execute('(array shape 0 fill 0) fold + with 10')).toBe(10n);
    expect(() => runtime.execute('(array shape 0 fill 0) fold +')).toThrow(/seed for empty input/);
});

it('keeps indexing and chained calls outside the declared arguments', () => {
    const runtime = new Interpreter();
    runtime.execute('fun X pair .with Y=2 = array X Y\nfun X scale Factor = X * Factor');
    expect(runtime.execute('3 pair with 7 1')).toBe(7n);
    expect(runtime.execute('3 scale 4 scale 5')).toBe(60n);
});

it('preserves nullary callback values and multiword comparison operators', () => {
    const runtime = new Interpreter();
    runtime.execute('fun constant = 9\nfun invoke op = op\nfun A B compare op = A B op');
    expect(runtime.execute('invoke constant')).toBe(9n);
    expect(runtime.execute('2 3 compare not equal')).toBe(true);
    expect(runtime.execute('2 3 compare at least')).toBe(false);
    expect(runtime.execute('2 3 compare at most')).toBe(true);
});

it('retains imported signatures across notebook cells and aliases', () => {
    const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'helper',
        source: 'fun X scale .by Factor=2 = X * Factor' }) });
    runtime.execute('use "helper" as H');
    expect(runtime.execute('3 H.scale by 4')).toBe(12n);
    runtime.execute('scaled = H.scale');
    expect(runtime.execute('3 scaled by 5')).toBe(15n);
});

it('ranks right-hand data and keeps the optional offset fixed', () => {
    const runtime = new Interpreter();
    runtime.execute('fun X add Y .with Offset=1 = X + Y + Offset');
    const value = runtime.execute('(array 1 2) add (array 10 20) with 5 rank 0 0');
    expect(value !== undefined && isRankArray(value) && value.items).toEqual([16n, 27n]);
});

it('normalizes memo defaults before looking up the cache', () => {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter();
    try {
        runtime.execute('memo X scale .by Factor=2 = X * Factor');
        diagnostics.run(() => {
            expect(runtime.execute('3 scale')).toBe(6n);
            expect(runtime.execute('3 scale by .NA')).toBe(6n);
            expect(runtime.execute('3 scale by 2')).toBe(6n);
        });
        expect(diagnostics.memoMisses).toBe(1);
        expect(diagnostics.memoHits).toBe(2);
    } finally { runtime.dispose(); }
});

it('recognizes optional words that otherwise start comments or builtin operator forms', () => {
    const runtime = new Interpreter();
    runtime.execute('fun X adjust .rem Offset=1 .scan Factor=2 = (X + Offset) * Factor');
    expect(runtime.execute('3 adjust rem 4 scan -2')).toBe(-14n);
    runtime.execute('fun X scale .scan Factor=2 = X * Factor');
    expect(runtime.execute('3 scale scan -2 rem an ordinary trailing comment')).toBe(-6n);
});

it('preserves result cell axes for ranked empty inputs with fixed configuration', () => {
    const runtime = new Interpreter();
    runtime.execute('fun X pair .with Y=2 = array X Y');
    const value = runtime.execute('(array shape 0 fill 0) pair rank 0');
    expect(value !== undefined && isRankArray(value) && value.shape).toEqual([0, 2]);
});

it('uses memo as a standalone declaration keyword', () => {
    expect(() => new Interpreter().execute('fun memo X square = X * X')).toThrow();
    expect(new Interpreter().execute('memo X square = X * X\n4 square')).toBe(16n);
});


it('preserves partial right data and optional words in function-expression bindings', () => {
    const runtime = new Interpreter();
    runtime.execute('fun X plus Y = X + Y\nf = plus 3\nfun X adjust .by Factor=2 = X * Factor\ng = adjust by 3');
    expect(runtime.execute('4 f')).toBe(7n);
    expect(runtime.execute('4 g')).toBe(12n);
});
