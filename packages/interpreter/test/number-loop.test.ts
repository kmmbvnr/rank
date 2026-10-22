import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}, interrupt = false) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    let error: string | undefined;
    try {
        const run = () => diagnostics.run(() => runtime.execute(source));
        try { interrupt ? withInterrupt(new Int32Array(1), run) : run(); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const candidate = execute(source);
    expect(candidate.observation).toEqual(execute(source, { compilation: false }).observation);
    expect(candidate.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    return candidate.diagnostics;
}

describe('private safe-integer loop registers', () => {
    it.each([
        [0, -1], [-1, -1], [2147483647, -1], [-2147483648, -1],
        [-2147483648, 2147483647], [123456789, -123456789],
    ])('inlines signed Int32 band for %s and %s', (left, right) => {
        const diagnostics = compare(`use bits\nA = ${left}\nB = ${right}\nfor I in 0 to 2\n R = A B band\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([
        ['2147483648', '-1'], ['-2147483649', '-1'],
        ['-1', '4294967296'], ['-1', '9007199254740991'],
    ])('replays band without truncating %s and %s or leaking private writes', (left, right) => {
        const diagnostics = compare(`use bits\nA = array shape 4096 fill 0\nB = A\nLeft = ${left}\nRight = ${right}\nfor I in 0 to 2\n A I += 1\n R = Left Right band\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('discards earlier iterations when a band operand grows past Int32', () => {
        const diagnostics = compare('use bits\nA = array 0 0 0\nB = A\nX = 2147483646\nfor I in 0 to 2\n A I += 1\n X += 1\n R = X -1 band\nend');
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        'for I in 0 to 2\n Before = I\n R = (A I) (A (I + 1)) band\n After = I\nend',
        'for I in 0 to 2\n Before = I\n R = 2147483648 (A (I + 1)) band\n After = I\nend',
        'for I in 0 to 2\n Before = I\n R = (7 // I) -1 band\n After = I\nend',
    ])('preserves band operand errors and partial state: %s', loop => {
        const source = `use bits\nA = array 1 2 3\n${loop}`;
        expect(execute(source).observation.error).toBeDefined();
        expect(compare(source).numberLoops).toBe(1);
    });

    it('does not evaluate band in an unreached boolean branch', () => {
        const diagnostics = compare('use bits\nWide = 4294967296\nfor I in 0 to 2\n R = I equal I or (Wide -1 band) equal 0\nend');
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([
        'use bits\nfor I in 0 to 2\n R = I 1.0 band\nend',
        'use bits\nfor I in 0 to 2\n fun A B band\n  return 10\n end\n R = I -1 band\nend',
        'for I in 0 to 2\n R = I -1 band\nend',
    ])('retains reference behavior for incompatible band bindings or operands: %s', source => {
        expect(compare(source).numberLoops).toBe(0);
    });

    it('rechecks band identity on a cached numeric loop', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use bits\nfun work\n S = 0\n for I in 1 to 3\n  S += I -1 band\n end\n return S\nend');
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(6n);
            expect(diagnostics.numberLoops).toBe(1);
            runtime.execute('fun A B replacement\n return 10\nend');
            runtime.variables.set('band', runtime.variables.get('replacement')!);
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(30n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('publishes band loop progress on cancellation and runs finally', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute('use bits\nA = array 0 0\nB = A\nLast = -1\nDone = 0\ntry\n for I in 0 to 1000000\n  A (I 1 band) += 1\n  Last = I\n end\nfinally\n Done = 1\nend')))).toThrow('Interrupted');
            runtime.execute('Total = A sum\nOriginal = B sum');
            expect(runtime.variables.get('Total')).toBe((runtime.variables.get('Last') as bigint) + 1n);
            expect(runtime.variables.get('Original')).toBe(0n);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('runs scalar arithmetic on Number without changing the integer value domain', () => {
        const source = 'S = 0\nfor I in 1 to 1000\n S += I mod 7 * 3 + 1\nend';
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.compiledLoops).toBe(1);
    });

    it.each(['for false\n continue\nend', 'for true\n break\nend'])('supports control regions without scalar registers: %s', source => {
        expect(compare(source).numberLoops).toBe(1);
    });

    it.each([
        'S = 9007199254740990\nfor I in 0 to 3\n S += 1\nend',
        'S = -9007199254740990\nfor I in 0 to 3\n S -= 1\nend',
        'S = 0\nA = 9007199254740991\nfor I in 0 to 2\n S += (A * 3) mod 7\nend',
        'S = 0\nA = 9007199254740991\nfor I in 0 to 2\n S += A * 3 - A * 3\nend',
        'S = 0\nfor I in 9007199254740990 to 9007199254740991\n S += 1\nend',
        'S = 0\nfor I in 0 to 3\n for J in 0 to 2\n  S += 9007199254740991\n end\nend',
    ])('discards private writes and uses exact original inputs on overflow: %s', source => {
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
        expect(diagnostics.compiledLoops).toBe(1);
    });

    it.each(['9007199254740992', '-9007199254740992'])('declines unsafe entry values: %s', value => {
        const diagnostics = compare(`S = ${value}\nfor I in 0 to 2\n S += I\nend`);
        expect(diagnostics.numberLoops).toBe(0);
    });

    it.each(['-7', '7', '-9007199254740991', '9007199254740991'])('preserves floor quotient, signed remainder and parity: %s', value => {
        const diagnostics = compare(`use numbers\nA = ${value}\nfor I in 1 to 2\n Q = A // -3\n R = A mod -3\n E = A even\n O = A odd\n A //= 3\n A mod= -2\nend`);
        expect(diagnostics.numberLoops).toBe(1);
    });

    it.each([
        'for I in 0 to 3\n Before = I\n Bad = 7 // (I - 2)\n After = I\nend',
        'A = array 1 2 3\nS = 0\nfor I in 0 to 3\n S += 1\n V = A I\nend',
        'for I in 0 to 2\n A = I\n if I equal 0\n  B = 3\n end\n C = I\nend',
        'for I in 3 to 0 by -1\n if I equal 2\n  continue\n end\n Last = I\n if I equal 1\n  break\n end\nend',
        'for I in 2 till 2\n NotCreated = I\nend',
    ])('preserves partial bindings, first-write order and control flow: %s', source => {
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(1);
    });

    it.each([
        'use numbers\nS = 0\nfor I in 1 to 20\n S += ((I ** 0.5) floor) + ((I sqrt) ceil) + (I ** 2)\nend',
        'use numbers\nfor I in 0 to 3\n Before = I\n N = (1 / I) floor\nend',
        'use numbers\nfor I in 1 to 3\n Before = I\n N = (1.0e308 ** I) floor\nend',
    ])('keeps real intermediates with integer outputs and original errors: %s', source => {
        expect(compare(source).numberLoops).toBe(1);
    });

    it.each([
        'A = array 0 0 0\nfor I in 0 to 2\n A I += I + 1\n R = A I\nend',
        'A = array shape 4096 fill 0\nB = A\nfor I in 0 to 3\n A I += I + 1\nend\nX = A 2\nY = B 2',
        'A = array 1 2 3\nB = A\nfor I in 0 to 2\n A I += 10\n B I *= 2\n R = A I + B I\nend',
        'A = array 1 2 3\nfor I in 0 to 2\n A I = I ** 2\n A I *= 2\n A I -= 1\nend',
        'A = array 1 2 3\nfor I in 0 to 2\n A I += 1\n if I equal 1\n  break\n end\nend',
        'A = array 1 2 3\nfor I in 0 to 2\n A I += 1\n if I equal 1\n  continue\n end\n After = I\nend',
        'A = array shape 0 fill 0\nfor I in 0 till 0\n A I += 1\nend',
        'A = array 0 0 0\nB = A\nfor I in 0 till 0\n A I += 1\nend',
        'A = array 0 0 0\nfor I in 0 to 2\n A I += 1\n Bad = 7 // (I - 1)\nend',
        'A = array 0 0 0\nfor I in 0 to 3\n Before = I\n A I += 1\nend',
        'A = array 0 0 0\nfor I in 2 to -1 by -1\n Before = I\n A I = I\nend',
        'A = array 0 0 0\nfor I in 0 to 2\n Before = I\n A I //= I\nend',
    ])('publishes private array cells with COW, control flow and partial errors: %s', source => {
        expect(compare(source).numberLoops).toBe(1);
    });

    it.each([
        'A = array 0 0 0\nS = 9007199254740990\nfor I in 0 to 2\n A I += 1\n S += 1\nend',
        'A = array 9007199254740991 0 0\nB = A\nfor I in 0 to 2\n A I += 1\nend',
        'A = array shape 4096 fill 0\nfor I in 0 to 2\n A I += 1\n for J in 1 to 3\n  S = 9007199254740991 * J\n end\nend',
    ])('discards every private array write before exact replay on overflow: %s', source => {
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('uses private writes after an ordinary selection has been completed', () => {
        const source = 'A = array 1 2 3\nSelection = A (0 to 1)\nfor I in 0 to 2\n A I += 1\nend\nOld = Selection 0';
        expect(compare(source).numberLoops).toBe(1);
        const values = execute(source).observation.variables;
        expect(values).toContainEqual(['Old', '1']);
        expect(values).toContainEqual(['A', '2 3 4']);
    });

    it('retains exact Int64 promotion for unsafe stored integers', () => {
        const source = 'A = array shape 4096 fill 9223372036854775807\nB = A\nfor I in 0 to 1\n A I += 1\nend';
        expect(compare(source).numberLoops).toBe(0);
    });

    it('invalidates dependent reductions when private cells are published', () => {
        const source = 'A = array 1 2 3\nBefore = A sum\nfor I in 0 to 2\n A I += 10\nend\nAfter = A sum';
        expect(compare(source).numberLoops).toBe(1);
        expect(execute(source).observation.variables).toContainEqual(['After', '36']);
    });

    it('publishes private array progress and scalar bindings on cancellation', () => {
        const source = 'A = array 0 0\nDone = 0\nLast = -1\ntry\n for I in 0 to 1000000\n  A (I mod 2) += 1\n  Last = I\n end\nfinally\n Done = 1\nend';
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(source)))).toThrow('Interrupted');
            runtime.execute('Total = A sum');
            expect(runtime.variables.get('Total')).toBe((runtime.variables.get('Last') as bigint) + 1n);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('replays a packed read-only scan from its original inputs on an unsafe cell', () => {
        const source = 'A = array shape 4096 fill 1\nA 1 = 9007199254740992\nS = 0\nfor I in 0 to 2\n S += A I\nend';
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
        expect(diagnostics.typedUnpacks).toBe(0);
    });

    it('uses invocation-owned numeric buffers for eager read-only arrays', () => {
        const diagnostics = compare('A = array 1 2 3\nS = 0\nfor I in 0 to 2\n for J in 0 to I\n  S += A J\n end\nend');
        expect(diagnostics.numberLoops).toBe(1);
    });

    it.each([
        'A = array 10 20 30\nS = 0\nfor V Index in A\n if Index equal 1\n  continue\n end\n S += V + Index\n V = 99\n Index = 99\nend',
        'A = array 1 2 3\nS = 0\nfor I in 1 to 2\n for V in A\n  S += I * V\n end\nend',
        'A = array 1 2 3\nS = 0\nfor V in A\n for W OtherIndex in A\n  S += V * W + OtherIndex\n  if OtherIndex equal 1\n   break\n  end\n end\nend',
        'A = array 10 20\nS = 0\nfor # Index in A\n S += Index\nend\nfor V # in A\n S += V\nend',
        'A = array 1 2 3\nS = 0\nfor V Index in (A)\n S += V\n Last = Index\nend',
        'A = array shape 0 fill 0\nfor V Index in A\n Unused = V\nend',
    ])('runs trusted vector traversal with private cursors: %s', source => {
        expect(execute(source).observation.error).toBeUndefined();
        expect(compare(source).numberLoops).toBeGreaterThan(0);
    });

    it('publishes preceding vector assignments at the original error location', () => {
        const source = 'A = array 1 2 3\nS = 0\nfor V Index in A\n S += V\n Bad = 7 // (2 - V)\nend';
        expect(execute(source).observation.error).toContain('division by zero');
        expect(compare(source).numberLoops).toBe(1);
    });

    it('replays overflowing vector regions from their original scalar inputs', () => {
        const diagnostics = compare('A = array 1 2 3\nS = 9007199254740990\nfor V Index in A\n S += V\nend');
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        'A = array shape 0 fill 0\nV = "kept"\nfor V Index in A\n Unused = 1\nend',
        'A = array shape 0 fill 0\nIndex = "held"\nfor V Index in A\n Unused = 1\nend',
        'A = array 1 2\nV = "held"\nfor V in A\n Before = 1\nend',
        'A = array 1 9007199254740992\nS = 0\nfor V in A\n S += V\nend',
        'A = array 1 2 3\nB = A\nS = 0\nfor V in A\n B 2 = 10\n S += V\nend',
    ])('retains exact fallback for incompatible bindings, unsafe cells and mutation: %s', source => {
        expect(compare(source).numberLoops).toBe(0);
    });

    it('does not leak fresh empty-vector bindings outside the loop scope', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute('A = array shape 0 fill 0\nfor V Index in A\n Unused = 1\nend'));
            expect(diagnostics.numberLoops).toBe(1);
            expect(runtime.variables.has('Index')).toBe(false);
            runtime.execute('V = "allowed"');
            runtime.execute('Index = "allowed too"');
        } finally { runtime.dispose(); }
    });

    it('does not declare a vector binding in an unreached nested loop', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute('A = array 1 2\nfor I in 0 till 0\n for V Index in A\n  Unused = V\n end\nend'));
            expect(diagnostics.numberLoops).toBe(1);
            runtime.execute('V = "allowed"\nIndex = "also allowed"');
        } finally { runtime.dispose(); }
    });

    it.each(['-1', '3'])('preserves direct-load bounds failures and partial state at index %s', index => {
        const source = `A = array 1 2 3\nS = 0\nfor V in A\n S += V\n Bad = A (${index})\n After = V\nend`;
        const candidate = execute(source);
        expect(candidate.observation.error).toContain('out of bounds');
        expect(candidate.observation).toEqual(execute(source, { compilation: false }).observation);
        // The existing generic BigInt iterator reader appends a negative
        // coordinate to its message; both paths must retain the same state.
        const exact = execute(source, { numberLoopCompilation: false });
        expect(exact.observation.error).toContain('out of bounds');
        expect(candidate.observation.variables).toEqual(exact.observation.variables);
        expect(candidate.diagnostics.numberLoops).toBe(1);
    });

    it('publishes vector progress and runs finally on Atomics cancellation', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`A = array 1 2 3
S = 0
Done = 0
try
 for V Index in A
  for I in 1 to 1000000
   S += V
  end
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            expect(diagnostics.numberLoops).toBe(1);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(runtime.variables.get('S')).toBeGreaterThan(0n);
            expect(runtime.variables.get('S')).toBeLessThan(1000000n);
        } finally { runtime.dispose(); }
    });

    it('declines arrays with unsafe cells before publishing any scalar', () => {
        const diagnostics = compare('A = array 1 9007199254740992\nS = 0\nfor I in 0 to 1\n S += A I\nend');
        expect(diagnostics.numberLoops).toBe(0);
    });

    it.each([
        'use algo\nQ = queue\nfor I in 0 to 1\n Q push I\nend',
        'fun N twice\n return N * 2\nend\nS = 0\nfor I in 0 to 1\n S += I twice\nend',
        'X = true\nfor I in 0 to 1\n Before = I\n X = I\nend',
        'X = 1.0\nfor I in 0 to 1\n Before = I\n X = I\nend',
        'S = 0\nfor I in 0 to 1\n S += 3 ** 33\nend',
    ])('retains the existing backend for effects, contracts and unproved powers: %s', source => {
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(0);
    });

    it('supports ordinary cancellation polling with private registers', () => {
        const source = 'S = 0\nfor I in 0 to 3\n S += I\nend';
        const interrupted = execute(source, {}, true);
        expect(interrupted.observation).toEqual(execute(source, { compilation: false }).observation);
        expect(interrupted.diagnostics.numberLoops).toBe(1);
    });

    it('publishes completed assignments on cancellation and runs finally', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`S = 0
Last = 0
Done = 0
try
 for I in 1 to 1000000
  S += I
  Last = I
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            const index = runtime.variables.get('Last') as bigint;
            expect(index).toBeGreaterThan(0n);
            expect(runtime.variables.get('S')).toBe(index * (index + 1n) / 2n);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('declines arbitrary host polling callbacks that could observe state', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const signal = { length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {} };
        try {
            withInterrupt(signal, () => diagnostics.run(() => runtime.execute('S = 0\nfor I in 0 to 3\n S += I\nend')));
            expect(runtime.variables.get('S')).toBe(6n);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('does not defer a binding contract changed by an entry hook', () => {
        let runtime: Interpreter;
        const diagnostics = new RuntimeDiagnostics();
        runtime = new Interpreter(() => {}, { onIntegerLoopExecuted: () => runtime.execute('Fresh = true') });
        try {
            expect(() => diagnostics.run(() => runtime.execute('Before = 0\nfor I in 1 to 3\n Before = I\n Fresh = I\nend'))).toThrow();
            expect(runtime.variables.get('Before')).toBe(1n);
            expect(runtime.variables.has('Fresh')).toBe(false);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('retains live array semantics for observable loop-entry hooks', () => {
        let runtime: Interpreter;
        const diagnostics = new RuntimeDiagnostics();
        runtime = new Interpreter(() => {}, { onIntegerLoopExecuted: () => runtime.execute('A 0 = 9') });
        try {
            diagnostics.run(() => runtime.execute('A = array 1 2\nS = 0\nfor I in 0 to 1\n S += A I\nend'));
            expect(runtime.variables.get('S')).toBe(11n);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });
});
