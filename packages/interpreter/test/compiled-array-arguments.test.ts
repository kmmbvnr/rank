import { expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, parse } from '../src/index.js';
import { isFunctionStatement } from '@arrrank/language';
import { compiledArgumentType } from '../src/compiled-argument-type.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { scalarFunctionResult } from '../src/scalar-function-proof.js';
import { setSemanticArrayType } from '../src/semantic-array-type.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import type { RankArray } from '../src/value.js';

it('reuses array type/rank proofs independently of identity and length', () => {
    const statement = parse('fun A cell I\nreturn (A I) + 1\nend').statements[0];
    if (!isFunctionStatement(statement)) throw new Error('expected function');
    const first = compiledArgumentType(ownedArray([2n]));
    const second = compiledArgumentType(ownedArray([4n, 5n]));
    expect(first).toEqual({ kind: 'array', element: 'integer', rank: 1 });
    expect(scalarFunctionResult(statement, true, [first!, 'integer']))
        .toBe(scalarFunctionResult(statement, true, [second!, 'integer']));
    let calls = 0;
    const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute('fun A cell I\nreturn (A I) + 1\nend');
        expect(runtime.execute('(array 2) cell 0')).toBe(3n);
        expect(runtime.execute('(array 4 5) cell 1')).toBe(6n);
        expect(calls).toBe(2);
    } finally { runtime.dispose(); }
});

it('compiles homogeneous integer, real, boolean and text cell reads', () => {
    for (const [values, expected] of [['array 2 3', '3'], ['array 2.0 3.5', '3.5'],
        ['array true false', 'false'], ['array "a" "λ"', 'λ']]) {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute('fun A cell\nreturn A 1\nend');
            expect(formatValue(runtime.execute(`(${values}) cell`)!)).toBe(expected);
            expect(calls).toBe(1);
        } finally { runtime.dispose(); }
    }
});

it('keeps rank, empty declarations, mutations and array results distinct', () => {
    let calls = 0;
    const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute('fun A count\nreturn A len\nend\nfun A identity\nreturn A\nend\nfun A cell I\nreturn A I\nend');
        expect(runtime.execute('(array shape 0 fill 0) count')).toBe(0n);
        runtime.execute('A = array 1 2');
        expect(runtime.execute('A cell 0')).toBe(1n);
        runtime.execute('A 0 = 9');
        expect(runtime.execute('A cell 0')).toBe(9n);
        expect(runtime.execute('A identity')).toBe(runtime.variables.get('A'));
        expect(calls).toBe(4);
        runtime.execute('fun A matrix\nreturn A 1 0\nend');
        expect(runtime.execute('(array shape 2 2 fill 7) matrix')).toBe(7n);
        expect(calls).toBe(5);
    } finally { runtime.dispose(); }
});

it('does not inspect lazy or host cells to select an array specialization', () => {
    let reads = 0;
    const host: RankArray = { kind: 'array', shape: [1], get items() { reads++; return [1n]; } };
    const lazy: RankArray = { kind: 'array', shape: [1], items: [], itemAt: () => { reads++; return 1n; } };
    expect(compiledArgumentType(host)).toBeUndefined();
    expect(compiledArgumentType(lazy)).toBeUndefined();
    expect(compiledArgumentType(ownedArray([]))).toBeUndefined();
    expect(reads).toBe(0);
});


it('preserves selection errors, call locations and short circuiting', () => {
    for (const body of ['return A 9', 'return A (-1)', 'return false and ((A 9) equal 0)']) {
        const outcomes = [false, true].map(scalarFunctionCompilation => {
            const runtime = new Interpreter(undefined, { scalarFunctionCompilation });
            try {
                return { value: runtime.execute(`fun A probe\n${body}\nend\n(array 1 2) probe`) };
            } catch (error) {
                if (!(error instanceof RankError)) throw error;
                return { error: error.format() };
            } finally { runtime.dispose(); }
        });
        expect(outcomes[1]).toEqual(outcomes[0]);
    }
});

it('binds text-array native calls and rejects captured assignments', () => {
    let calls = 0;
    const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute('use text\nfun A joined\nreturn A join ":"\nend');
        expect(runtime.execute('(array "λ" "😀") joined')).toBe('λ:😀');
        expect(calls).toBe(1);
        expect(() => runtime.execute('fun A outer\nB = A\nfun C replace\nB = C\nreturn B\nend\n(array 9 8) replace\nreturn B\nend\n(array 1 2) outer')).toThrow('B is bound in an enclosing function');
        expect(calls).toBe(1);
    } finally { runtime.dispose(); }
});


it('uses typed storage proofs and keeps long boxed-cell validation interruptible', () => {
    const typed = typedArray(new BigInt64Array([1n, 2n]));
    expect(compiledArgumentType(typed)).toBeUndefined();
    setSemanticArrayType(typed, { key: '["integer"]', scalar: 'integer' });
    expect(compiledArgumentType(typed))
        .toEqual({ kind: 'array', element: 'integer', rank: 1 });
    // A cell past 64 bits keeps the cells boxed.
    const values = ownedArray([1n << 64n, ...Array<bigint>(9999).fill(1n)]);
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(signal, 0, 1);
    expect(() => withInterrupt(signal, () => compiledArgumentType(values))).toThrow(InterruptedError);
});

it('rechecks mutable storage and switches prepared calls back to inspection', () => {
    const values = ownedArray([1n]);
    expect(compiledArgumentType(values)).toMatchObject({ element: 'integer' });
    values.items[0] = 2.5;
    const changed = compiledArgumentType(values);
    expect(changed === undefined || typeof changed !== 'string' && changed.element === 'real').toBe(true);
    let calls = 0;
    const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute('fun A cell\nreturn A 0\nend');
        expect(runtime.execute('(array 3) cell')).toBe(3n);
        expect(calls).toBe(1);
        const signal = new Int32Array(new SharedArrayBuffer(12));
        expect(withInterrupt(signal, () => runtime.execute('(array 4) cell'), () => {})).toBe(4n);
        expect(calls).toBe(1);
    } finally { runtime.dispose(); }
});

it('preserves aliases returned through local array bindings', () => {
    const source = 'fun A pass\nB = A\nreturn B\nend\nSource = array 1 2\nAlias = Source pass\nAlias 0 = 9\ntuple Source Alias';
    const results = [false, true].map(scalarFunctionCompilation => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { scalarFunctionCompilation, onScalarFunctionExecuted: () => calls++ });
        try { return { value: formatValue(runtime.execute(source)!), calls }; }
        finally { runtime.dispose(); }
    });
    expect(results[1].value).toBe(results[0].value);
    expect(results[0].calls).toBe(0);
    expect(results[1].calls).toBe(1);
});

it.each(['queue', 'stack', 'deque'])('links private %s materialization and read-only array calls', kind => {
    const source = `use algo
fun N build
 Q = new ${kind}
 for I in 1 to N
  Q push I
 end
 return Q array
end
fun A read
 return (A 0) + (A len)
end
fun N total
 A = N build
 return A read
end`;
    const runs = [false, true].map(compilation => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(source);
            return { values: ['3 total', '1 total', '0 build', '5 build'].map(s => formatValue(runtime.execute(s)!)), calls };
        } finally { runtime.dispose(); }
    });
    expect(runs[1].values).toEqual(runs[0].values);
    expect(runs[1].calls).toBeGreaterThanOrEqual(8);
});

it('preserves COW when a linked array result aliases a caller operand', () => {
    const source = `fun A identity
 return A
end
fun A changed
 B = A identity
 A 0 = 9
 return (B 0) + (A 0)
end
A = array 1 2
R = 0
for I in 0 to 1
 R = A changed
end`;
    const runs = [false, true].map(compilation => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(source);
            return { values: ['A', 'R'].map(s => formatValue(runtime.execute(s)!)), calls };
        } finally { runtime.dispose(); }
    });
    expect(runs[1].values).toEqual(runs[0].values);
    expect(runs[1].values).toEqual(['1 2', '10']);
    expect(runs[1].calls).toBeGreaterThan(0);
});

it('snapshots a linked integer-container result before later shared mutations', () => {
    const source = `use algo
fun Q snapshot
 return Q array
end
fun N total
 Q = new queue
 Q push N
 A = Q snapshot
 Q push (N + 1)
 return (A 0) + (A len) + (Q len)
end`;
    const runs = [false, true].map(compilation => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(source);
            return { values: [runtime.execute('3 total'), runtime.execute('10 total')], calls };
        } finally { runtime.dispose(); }
    });
    expect(runs[1].values).toEqual(runs[0].values);
    expect(runs[1].values).toEqual([6n, 13n]);
    expect(runs[1].calls).toBeGreaterThanOrEqual(4);
});
