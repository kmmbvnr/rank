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
    const statement = parse('fun cell A I\nreturn (A I) + 1\nend').statements[0];
    if (!isFunctionStatement(statement)) throw new Error('expected function');
    const first = compiledArgumentType(ownedArray([2n]));
    const second = compiledArgumentType(ownedArray([4n, 5n]));
    expect(first).toEqual({ kind: 'array', element: 'integer', rank: 1 });
    expect(scalarFunctionResult(statement, true, [first!, 'integer']))
        .toBe(scalarFunctionResult(statement, true, [second!, 'integer']));
    let calls = 0;
    const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute('fun cell A I\nreturn (A I) + 1\nend');
        expect(runtime.execute('(array 2) 0 cell')).toBe(3n);
        expect(runtime.execute('(array 4 5) 1 cell')).toBe(6n);
        expect(calls).toBe(2);
    } finally { runtime.dispose(); }
});

it('compiles homogeneous integer, real, boolean and text cell reads', () => {
    for (const [values, expected] of [['array 2 3', '3'], ['array 2.0 3.5', '3.5'],
        ['array true false', 'false'], ['array "a" "λ"', 'λ']]) {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute('fun cell A\nreturn A 1\nend');
            expect(formatValue(runtime.execute(`(${values}) cell`)!)).toBe(expected);
            expect(calls).toBe(1);
        } finally { runtime.dispose(); }
    }
});

it('keeps rank, empty declarations, mutations and array results distinct', () => {
    let calls = 0;
    const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute('fun count A\nreturn A len\nend\nfun identity A\nreturn A\nend\nfun cell A I\nreturn A I\nend');
        expect(runtime.execute('(array shape 0 fill 0) count')).toBe(0n);
        runtime.execute('A = array 1 2');
        expect(runtime.execute('A 0 cell')).toBe(1n);
        runtime.execute('A 0 = 9');
        expect(runtime.execute('A 0 cell')).toBe(9n);
        expect(runtime.execute('A identity')).toBe(runtime.variables.get('A'));
        expect(calls).toBe(4);
        runtime.execute('fun matrix A\nreturn A 1 0\nend');
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
                return { value: runtime.execute(`fun probe A\n${body}\nend\n(array 1 2) probe`) };
            } catch (error) {
                if (!(error instanceof RankError)) throw error;
                return { error: error.format() };
            } finally { runtime.dispose(); }
        });
        expect(outcomes[1]).toEqual(outcomes[0]);
    }
});

it('binds text-array native calls and preserves captured assignments', () => {
    let calls = 0;
    const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute('use text\nfun joined A\nreturn A ":" join\nend');
        expect(runtime.execute('(array "λ" "😀") joined')).toBe('λ:😀');
        expect(calls).toBe(1);
        const result = runtime.execute('fun outer A\nB = A\nfun replace C\nB = C\nreturn B\nend\n(array 9 8) replace\nreturn B\nend\n(array 1 2) outer');
        expect(formatValue(result!)).toBe('9 8');
        expect(calls).toBe(1);
    } finally { runtime.dispose(); }
});


it('uses typed storage proofs and keeps long boxed-cell validation interruptible', () => {
    const typed = typedArray(new BigInt64Array([1n, 2n]));
    expect(compiledArgumentType(typed)).toBeUndefined();
    setSemanticArrayType(typed, { key: '["integer"]', scalar: 'integer' });
    expect(compiledArgumentType(typed))
        .toEqual({ kind: 'array', element: 'integer', rank: 1 });
    const values = ownedArray(Array<bigint>(10000).fill(1n));
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
        runtime.execute('fun cell A\nreturn A 0\nend');
        expect(runtime.execute('(array 3) cell')).toBe(3n);
        expect(calls).toBe(1);
        const signal = new Int32Array(new SharedArrayBuffer(12));
        expect(withInterrupt(signal, () => runtime.execute('(array 4) cell'), () => {})).toBe(4n);
        expect(calls).toBe(1);
    } finally { runtime.dispose(); }
});

it('preserves aliases returned through local array bindings', () => {
    const source = 'fun pass A\nB = A\nreturn B\nend\nSource = array 1 2\nAlias = Source pass\nAlias 0 = 9\ntuple Source Alias';
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
