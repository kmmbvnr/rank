import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, isRankArray, type RankValue } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';
import { ownedArray } from '../src/array-storage.js';

const change = `fun A change
  A 0 = 9
  return A
end`;

function execute(source: string, compiled: boolean, inspect = false) {
    const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const run = () => diagnostics.run(() => runtime.execute(source));
        const value = inspect ? withInterrupt(new Int32Array(new SharedArrayBuffer(4)), run, () => {}) : run();
        return { value: value && isRankArray(value) ? [...value.items] : value, copies: diagnostics.cowCopies };
    } finally { runtime.dispose(); }
}

describe.each([false, true])('last array use with integer compilation %s', compiled => {
    it.each(['return A change', 'B = A change\n  return B'])('transfers a private local: %s', continuation => {
        expect(execute(`${change}\nfun solve\n  A = array 1 2 3\n  ${continuation}\nend\nsolve`, compiled))
            .toEqual({ value: [9n, 2n, 3n], copies: 0 });
    });

    it('transfers a uniquely owned parameter after addressed writes', () => {
        expect(execute(`${change}\nfun A forward\n A 1 = 4\n return A change\nend\n(array 1 2 3) forward`, compiled))
            .toEqual({ value: [9n, 4n, 3n], copies: 0 });
    });

    it.each(['First = A 0', 'First = (A (-0))', 'First = (A 0)\n  Second = A 1'])
        ('transfers a private buffer after bound cell reads: %s', reads => {
            expect(execute(`${change}\nfun A forward\n  ${reads}\n  return A change\nend\n(array 1 2 3) forward`, compiled))
                .toEqual({ value: [9n, 2n, 3n], copies: 0 });
        });

    it('retains the scalar read before handing off a private local', () => {
        expect(execute(`${change}\nfun solve\n A = array 1 2 3\n First = A 0\n B = A change\n return First + B 0\nend\nsolve`, compiled))
            .toEqual({ value: 10n, copies: 0 });
    });

    it('transfers after a scalar computation that reads the buffer', () => {
        expect(execute(`${change}\nfun solve\n A = array 1 2 3\n First = (A 0) + 1\n B = A change\n return First + B 0\nend\nsolve`, compiled))
            .toEqual({ value: 11n, copies: 0 });
    });

    it('transfers after a scalar comparison in a condition', () => {
        expect(execute(`${change}\nfun A forward\n if (A 0) equal 1\n  First = 0\n end\n return A change\nend\n(array 1 2 3) forward`, compiled))
            .toEqual({ value: [9n, 2n, 3n], copies: 0 });
    });

    it.each(['I', '(I + 1)', '((I + 2) // 2)', '((I + 2) mod 3)', '(I ** 2)'])
        ('transfers after reading with an unchanged integer parameter: %s', selector => {
            expect(execute(`${change}\nfun A forward I\n First = A ${selector}\n return A change\nend\n(array 1 2 3) forward 0`, compiled))
                .toEqual({ value: [9n, 2n, 3n], copies: 0 });
        });

    it('transfers after a computed index bound once in the caller', () => {
        expect(execute(`${change}\nfun solve\n A = array 1 2 3\n I = 0\n First = A (I + 1)\n B = A change\n return First + B 0\nend\nsolve`, compiled))
            .toEqual({ value: 11n, copies: 0 });
    });

    it('keeps collection selectors on the ordinary copy path', () => {
        expect(execute(`${change}\nfun A forward I\n First = A I\n B = A change\n return First 0 + B 0\nend\n(array 1 2 3) forward (array 0)`, compiled))
            .toEqual({ value: 10n, copies: 1 });
    });

    it('does not infer the old selector from a later integer binding', () => {
        expect(execute(`${change}\nfun solve\n A = array 1 2 3\n I = 0\n First = A I\n I += 1\n return A change\nend\nsolve`, compiled))
            .toEqual({ value: [9n, 2n, 3n], copies: 1 });
    });

    it('does not borrow through a callable index bound once', () => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        let saved: RankValue | undefined;
        runtime.variables.set('retain', { kind: 'function', name: 'retain', arities: [1], monadicRank: 'all',
            call: values => { saved = values[0]; return 0n; } });
        try {
            runtime.execute(`${change}\nfun solve\n A = array 1 2 3\n i = retain\n First = A i\n return A change\nend\nsolve`);
            expect(saved !== undefined && isRankArray(saved) && [...saved.items]).toEqual([1n, 2n, 3n]);
        } finally { runtime.dispose(); }
    });

    it('rejects a callable parameter at the integer selector guard', () => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        let saved: RankValue | undefined;
        runtime.variables.set('retain', { kind: 'function', name: 'retain', arities: [1], monadicRank: 'all',
            call: values => { saved = values[0]; return 0n; } });
        try {
            runtime.execute(`${change}\nfun A forward i\n First = A i\n return A change\nend\n(array 1 2 3) forward retain`);
            expect(saved !== undefined && isRankArray(saved) && [...saved.items]).toEqual([1n, 2n, 3n]);
        } finally { runtime.dispose(); }
    });

    it('rejects an index assignment colliding with an enclosing binding', () => {
        expect(() => execute(`${change}\nfun outer\n I = 0\n fun forward\n  A = array 1 2 3\n  I = 0\n  First = A I\n  return A change\n end\n return forward\nend\nouter`, compiled))
            .toThrow('I is bound in an enclosing function');
    });

    it('does not infer a past global selector from its current integer value', () => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        let saved: RankValue | undefined;
        runtime.variables.set('I', { kind: 'function', name: 'retain', arities: [1], monadicRank: 'all',
            call: values => { saved = values[0]; return 0n; } });
        runtime.variables.set('reset', { kind: 'function', name: 'reset', arities: [1], monadicRank: 'all',
            call: () => { runtime.variables.set('I', 0n); return 0n; } });
        try {
            runtime.execute(`${change}\nfun solve\n A = array 1 2 3\n First = A I\n Ignored = 0 reset\n return A change\nend\nsolve`);
            expect(runtime.variables.get('I')).toBe(0n);
            expect(saved !== undefined && isRankArray(saved) && [...saved.items]).toEqual([1n, 2n, 3n]);
        } finally { runtime.dispose(); }
    });

    it('keeps a matrix row alias on the ordinary ownership path', () => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        const diagnostics = new RuntimeDiagnostics();
        runtime.variables.set('Input', ownedArray([1n, 2n, 3n, 4n], [2, 2]));
        try {
            const value = diagnostics.run(() => runtime.execute(`fun A change\n A 0 0 = 9\n return A\nend\nfun A forward\n First = A 0\n B = A change\n return First 0 + (B 0) 0\nend\nInput forward`));
            expect(value).toBe(10n);
            expect(diagnostics.cowCopies).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('preserves both caller and callee argument diagnostics during parameter transfer', () => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        try {
            let failure: unknown;
            try {
                runtime.execute(`fun A fail\n A 0 = 9\n .Failure "failed" raise\n return A\nend\nfun A forward\n B = A fail\n return B\nend\n(array 1 2 3) forward`);
            } catch (error) { failure = error; }
            expect(failure).toBeInstanceOf(RankError);
            expect((failure as RankError).formatCalls()).toContain('fail\n  A = array[3]: 1 2 3');
            expect((failure as RankError).formatCalls()).toContain('forward\n  A = array[3]: 1 2 3');
        } finally { runtime.dispose(); }
    });

    it('retains the original value for a later parent read', () => {
        expect(execute(`${change}\nfun solve\n  A = array 1 2 3\n  B = A change\n  return A 0 + B 0\nend\nsolve`, compiled))
            .toEqual({ value: 10n, copies: 1 });
    });

    it('keeps global arrays and parameter diagnostics observable', () => {
        expect(execute(`${change}\nfun A forward\n  return A change\nend\nA = array 1 2 3\nB = A forward\nA 0 + B 0`, compiled))
            .toEqual({ value: 10n, copies: 1 });
    });

    it.each(['Saved = A', 'Saved = A * 2'])('rejects shared storage: %s', alias => {
        const expected = alias.includes('*') ? 11n : 10n;
        expect(execute(`${change}\nfun solve\n  A = array 1 2 3\n  ${alias}\n  B = A change\n  return Saved 0 + B 0\nend\nsolve`, compiled))
            .toEqual({ value: expected, copies: 1 });
    });

    it('does not move an argument supplied twice', () => {
        expect(execute(`fun A change B\n A 0 = 9\n return A 0 + B 0\nend\nfun solve\n A = array 1 2 3\n return A change A\nend\nsolve`, compiled))
            .toEqual({ value: 10n, copies: 1 });
    });

    it('rejects locals captured by a nested function', () => {
        expect(execute(`${change}\nfun solve\n A = array 1 2 3\n fun saved\n  return A 0\n end\n B = A change\n return saved + B 0\nend\nsolve`, compiled))
            .toEqual({ value: 10n, copies: 1 });
    });

    it('preserves caught errors and the original array', () => {
        const source = `fun A fail\n A 0 = 9\n .Failure "failed" raise\n return A\nend\nfun solve\n A = array 1 2 3\n try\n  B = A fail\n catch Error\n  return A 0\n end\n return A 0\nend\nsolve`;
        expect(execute(source, compiled)).toEqual({ value: 1n, copies: 1 });
    });

    it('records the original transferred argument in an escaping error', () => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        const diagnostics = new RuntimeDiagnostics();
        try {
            let failure: unknown;
            try {
                diagnostics.run(() => runtime.execute(`fun A fail\n A 0 = 9\n .Failure "failed" raise\n return A\nend\nfun solve\n A = array 1 2 3\n return A fail\nend\nsolve`));
            } catch (error) { failure = error; }
            expect(failure).toBeInstanceOf(RankError);
            expect((failure as RankError).formatCalls()).toContain('A = array[3]: 1 2 3');
            expect(diagnostics.cowCopies).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('transfers a buffer after filling it in a loop', () => {
        const result = execute(`${change}\nfun solve\n A = array shape 4096 fill 0\n for I in 0 till 4096\n  A I = I\n end\n return A change\nend\nsolve`, compiled);
        expect(result.copies).toBe(0);
        expect((result.value as bigint[]).slice(0, 3)).toEqual([9n, 1n, 2n]);
    });

    it('preserves aliases created inside the receiving function', () => {
        expect(execute(`fun A change\n Saved = A\n A 0 = 9\n return Saved 0 + A 0\nend\nfun solve\n A = array 1 2 3\n return A change\nend\nsolve`, compiled))
            .toEqual({ value: 10n, copies: 1 });
    });

    it('does not consume a local used again on the next loop iteration', () => {
        expect(execute(`${change}\nfun solve\n A = array 1 2 3\n Total = 0\n for I in 0 till 2\n  B = A change\n  Total += B 0\n end\n return Total\nend\nsolve`, compiled))
            .toEqual({ value: 18n, copies: 2 });
    });

    it('keeps generators on the ordinary ownership path', () => {
        expect(execute(`use sequences\nfun A changed\n A 0 = 9\n yield A\nend\nfun solve\n A = array 1 2 3\n Rows = A changed\n return Rows array\nend\nsolve`, compiled).copies).toBe(1);
    });

    it.each(['retain', 'len'])('rejects a buffer previously exposed to the host callback %s', reader => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        let saved: RankValue | undefined;
        runtime.variables.set(reader, { kind: 'function', name: reader, arities: [1], monadicRank: 'all',
            call: values => { saved = values[0]; return 0n; } });
        try {
            runtime.execute(`${change}\nfun solve\n A = array 1 2 3\n First = A 0\n Ignored = A ${reader}\n return A change\nend\nsolve`);
            expect(saved !== undefined && isRankArray(saved) && [...saved.items]).toEqual([1n, 2n, 3n]);
        } finally { runtime.dispose(); }
    });

    it('keeps inspection on the ordinary copy path', () => {
        expect(execute(`${change}\nfun solve\n A = array 1 2 3\n B = A change\n return B\nend\nsolve`, compiled, true))
            .toEqual({ value: [9n, 2n, 3n], copies: 1 });
    });
});
