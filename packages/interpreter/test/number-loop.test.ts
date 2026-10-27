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
    it.each(['normal', 'overflow', 'bounds'])('compiles a larger guarded array region with %s semantics', mode => {
        const writes = Array.from({ length: 64 }, () => ' A 0 = A 0 + A 1 + I').join('\n');
        const source = `A = array 0 1
Alias = A
for I in 0 to 1
${writes}
${mode === 'overflow' ? ' A 0 += 9007199254740991' : mode === 'bounds' ? ' A 2 = 3' : ''}
end`;
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(mode === 'overflow' ? 1 : 0);
    });

    it('reports the temporary budget when a large region retains exact execution', () => {
        const rhs = ['A 0', ...Array(15).fill('A 1'), 'I'].join(' + ');
        const writes = Array.from({ length: 100 }, () => ' A 0 = ' + rhs).join('\n');
        const diagnostics = compare(`A = array 0 1
for I in 0 to 1
${writes}
end`);
        expect(diagnostics.numberLoops).toBe(0);
        expect(diagnostics.compilerRejections.some(failure => failure.reason.startsWith('number-loop:temporary-budget:'))).toBe(true);
    });

    it.each(['continue', 'break'])('retains a nested real result type across %s', control => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        try {
            const value = diagnostics.run(() => runtime.execute(`for Outer in 0 to 0
 for Inner in 0 to 1
  if Inner equal 1
   Integer = 1
   ${control}
  end
  Real = 0.5
 end
end`));
            expect(value).toBe(0.5);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it.each(['2147483647', '-2147483649', '9007199254740989'])('widens private Int32 stores without truncating %s', wide => {
        const diagnostics = compare(`A = array shape 4096 fill 0
Alias = A
Wide = ${wide}
for I in 0 to 2
 A I = Wide + I
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it('publishes compound stores after a private buffer widens', () => {
        const diagnostics = compare(`A = array shape 4096 fill 2147483647
for I in 0 to 2
 A I += 1
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([0, 1, 64])('admits condition-loop scratch arrays with %i cells', size => {
        const diagnostics = compare(`A = array shape ${size} fill 0
Alias = A
J = 0
for J less 3
 if ${size} greater 0
  A 0 += 1
 end
 J += 1
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([65, 4096])('probes condition-loop copying for %i cells', size => {
        const diagnostics = compare(`A = array shape ${size} fill 0
J = 0
for J less 3
 A 0 += 1
 J += 1
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopCopyProbes).toBe(1);
        expect(diagnostics.numberLoopCopyAmortized).toBe(0);
    });

    it('bounds combined scratch destinations rather than individual arrays', () => {
        const diagnostics = compare(`A = array shape 40 fill 0
B = array shape 40 fill 0
Go = true
for Go
 A 0 = 1
 B 0 = 2
 Go = false
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopCopyProbes).toBe(1);
        expect(diagnostics.numberLoopCopyAmortized).toBe(0);
    });

    it.each(['9007199254740991', '0'])('retains exact replay and partial errors for small scratch storage (%s)', value => {
        const diagnostics = compare(`A = array 0 0
Alias = A
X = ${value}
J = 0
for J less 3
 A J = X + J + 1
 J += 1
end`);
        expect(diagnostics.numberLoops).toBe(1);
    });

    it('keeps zero-iteration scratch buffers and bindings untouched', () => {
        const diagnostics = compare('A = array 1 2\nAlias = A\nGo = false\nfor Go\n A 0 = 3\n New = 5\nend');
        expect(diagnostics.numberLoops).toBe(1);
    });

    it.each([
        ['bor', '-2147483648', '2147483647'], ['bor', '-1', '0'],
        ['shl', '1', '30'], ['shl', '-2147483648', '21'],
        ['bit', '2147483647', '30'], ['bit', '0', '0'],
    ])('inlines checked Number %s for %s and %s', (operation, left, right) => {
        const diagnostics = compare(`use bits\nLeft = ${left}\nRight = ${right}\nfor I in 0 to 2\n R = Left ${operation} Right\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([
        ['bor', '2147483648', '-1'], ['bor', '-2147483649', '0'],
        ['shl', '1', '31'], ['shl', '1', '32'], ['shl', '1', '53'],
        ['shl', '2147483647', '23'], ['shl', '1', '-1'],
        ['bit', '2147483648', '31'], ['bit', '1', '32'],
        ['bit', '-1', '0'], ['bit', '1', '-1'],
    ])('replays %s for %s and %s without publishing private writes', (operation, left, right) => {
        const diagnostics = compare(`use bits\nA = array 0 0 0\nAlias = A\nLeft = ${left}\nRight = ${right}\nfor I in 0 to 2\n A I += 1\n R = Left ${operation} Right\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('uses direct exact stores for repeatedly entered condition loops', () => {
        const diagnostics = compare(`A = array shape 4096 fill 0
J = 0
for J less 20
 Go = true
 for Go
  A J = J
  Go = false
 end
 J += 1
 Scratch = tuple J
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopCopyAmortized).toBe(0);
        expect(diagnostics.compiledLoops).toBe(20);
        expect(diagnostics.cowCopies).toBe(0);
    });

    it.each([
        [0, -1], [-1, -1], [2147483647, -1], [-2147483648, -1],
        [-2147483648, 2147483647], [123456789, -123456789],
    ])('inlines signed Int32 band for %s and %s', (left, right) => {
        const diagnostics = compare(`use bits\nA = ${left}\nB = ${right}\nfor I in 0 to 2\n R = A band B\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([
        ['2147483648', '-1'], ['-2147483649', '-1'],
        ['-1', '4294967296'], ['-1', '9007199254740991'],
    ])('replays band without truncating %s and %s or leaking private writes', (left, right) => {
        const diagnostics = compare(`use bits\nA = array shape 4096 fill 0\nB = A\nLeft = ${left}\nRight = ${right}\nfor I in 0 to 2\n A I += 1\n R = Left band Right\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('discards earlier iterations when a band operand grows past Int32', () => {
        const diagnostics = compare('use bits\nA = array 0 0 0\nB = A\nX = 2147483646\nfor I in 0 to 2\n A I += 1\n X += 1\n R = X band -1\nend');
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        [0, -1], [-1, -1], [2147483647, -1], [-2147483648, -1],
        [-2147483648, 2147483647], [123456789, -123456789],
    ])('inlines signed Int32 bxor for %s and %s', (left, right) => {
        const diagnostics = compare(`use bits\nA = ${left}\nB = ${right}\nfor I in 0 to 2\n R = A bxor B\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each(['2147483648', '-2147483649', '4294967296', '9007199254740991'])('replays wide bxor operands exactly: %s', wide => {
        const diagnostics = compare(`use bits\nA = array shape 4096 fill 0\nB = A\nWide = ${wide}\nfor I in 0 to 2\n A I += 1\n R = Wide bxor -1\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('discards private cells if a bxor operand becomes too wide after earlier iterations', () => {
        const diagnostics = compare('use bits\nA = array 0 0 0\nB = A\nX = 2147483646\nfor I in 0 to 2\n A I += 1\n X += 1\n R = -1 bxor X\nend');
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('preserves bxor operand errors after preceding array mutations', () => {
        const source = 'use bits\nA = array 1 2 3\nB = array 0 0 0\nfor I in 0 to 2\n B I += 1\n R = (A I) bxor (A (I + 1))\nend';
        expect(execute(source).observation.error).toContain('out of bounds');
        expect(compare(source).numberLoops).toBe(1);
    });

    it('rechecks the bxor builtin before entering a cached numeric loop', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use bits\nfun work\n S = 0\n for I in 1 to 3\n  S += I bxor 1\n end\n return S\nend');
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(5n);
            expect(diagnostics.numberLoops).toBe(1);
            runtime.execute('fun A replacement B\n return 10\nend');
            runtime.variables.set('bxor', runtime.variables.get('replacement')!);
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(30n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it.each([
        'for I in 0 to 2\n Before = I\n R = (A I) band (A (I + 1))\n After = I\nend',
        'for I in 0 to 2\n Before = I\n R = 2147483648 band (A (I + 1))\n After = I\nend',
        'for I in 0 to 2\n Before = I\n R = (7 // I) band -1\n After = I\nend',
    ])('preserves band operand errors and partial state: %s', loop => {
        const source = `use bits\nA = array 1 2 3\n${loop}`;
        expect(execute(source).observation.error).toBeDefined();
        expect(compare(source).numberLoops).toBe(1);
    });

    it('does not evaluate band in an unreached boolean branch', () => {
        const diagnostics = compare('use bits\nWide = 4294967296\nfor I in 0 to 2\n R = I equal I or (Wide band -1) equal 0\nend');
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([
        'use bits\nfor I in 0 to 2\n R = I band 1.0\nend',
        'use bits\nfor I in 0 to 2\n fun A band B\n  return 10\n end\n R = I band -1\nend',
        'for I in 0 to 2\n R = I band -1\nend',
    ])('retains reference behavior for incompatible band bindings or operands: %s', source => {
        expect(compare(source).numberLoops).toBe(0);
    });

    it('rechecks band identity on a cached numeric loop', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use bits\nfun work\n S = 0\n for I in 1 to 3\n  S += I band -1\n end\n return S\nend');
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(6n);
            expect(diagnostics.numberLoops).toBe(1);
            runtime.execute('fun A replacement B\n return 10\nend');
            runtime.variables.set('band', runtime.variables.get('replacement')!);
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(30n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('publishes band loop progress on cancellation and runs finally', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute('use bits\nA = array 0 0\nB = A\nLast = -1\nDone = 0\ntry\n for I in 0 to 1000000\n  A (I band 1) += 1\n  Last = I\n end\nfinally\n Done = 1\nend')))).toThrow('Interrupted');
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

    it.each(['9007199254740992', '-9007199254740992'])('keeps wide scalar results exact with numeric control: %s', value => {
        const diagnostics = compare(`S = ${value}\nfor I in 0 to 2\n S += I\nend`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
    });

    it.each(['9007199254740991', '-9007199254740991'])('keeps wide products, signed division and scalar dependencies exact: %s', value => {
        const diagnostics = compare(`Base = ${value}
Total = 0
for I in 1 to 3
 Product = Base * I
 Quotient = Product // -3
 Remainder = Product mod -3
 Bound = Product min 20
 Total += Quotient + Remainder + Bound
end`);
        expect(diagnostics.numberLoops).toBe(2);
        expect(diagnostics.numberLoopOverflows).toBe(1);
        expect(diagnostics.compiledLoops).toBe(1);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
    });

    it.each([
        'for I in 0 to 2\n A I += 1\n Wide += A I * Base\n Bad = 10 // (1 - I)\n After = I\nend',
        'for I in 0 to 2\n A I += 1\n Wide += Base\n Value = A (Base + I)\nend',
        'for I in 0 to 2\n A I += 1\n Wide += Base\n Value = A (-Base - I)\nend',
    ])('publishes exact scalar progress and COW stores at the original error: %s', loop => {
        const source = `A = array shape 4096 fill 0\nSaved = A\nBase = 9007199254740991\nWide = 9007199254740993\n${loop}`;
        expect(execute(source).observation.error).toBeDefined();
        const diagnostics = compare(source);
        expect(diagnostics.compiledLoops).toBe(1);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
    });

    it.each([
        'Value = Base\nfor I in 0 to 2\n Value += 1\n if Value greater Base\n  Last = I\n end\nend',
        'Value = Base\nfor I in 0 to 2\n Copy = Value\n Value += 1\n if Copy greater Base\n  Last = I\n end\nend',
        'Value = Base\nfor I in 0 to 2\n Copy = Value\n Value += 1\n A I = Copy\nend',
        'for I in 0 to 1\n for J in 1 to Base\n  Last = J\n  break\n end\nend',
    ])('retains exact fallback for wide control, loop-carried and cell-store dependencies: %s', loop => {
        const diagnostics = compare(`A = array 0 0 0\nBase = 9007199254740993\n${loop}`);
        expect(diagnostics.numberLoops).toBe(0);
        expect(diagnostics.compiledLoops).toBe(1);
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
        'A = array 9007199254740991 0 0\nB = A\nfor I in 0 to 2\n A I += 1\nend',
    ])('discards every private array write before exact replay on overflow: %s', source => {
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        'A = array 0 0 0\nS = 9007199254740990\nfor I in 0 to 2\n A I += 1\n S += 1\nend',
        'A = array shape 4096 fill 0\nfor I in 0 to 2\n A I += 1\n for J in 1 to 3\n  S = 9007199254740991 * J\n end\nend',
    ])('discards numeric stores before retrying with exact scalar results: %s', source => {
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(2);
        expect(diagnostics.numberLoopOverflows).toBe(1);
        expect(diagnostics.compiledLoops).toBe(1);
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
        expect(diagnostics.numberLoops).toBe(2);
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

    it.each([
        'A = array 1 2 3\nB = array 0 0 0\nfor V Index in A\n B Index += V\nend',
        'A = array 1 2 3\nB = A\nS = 0\nfor V in A\n B 2 = 10\n S += V\nend',
        'A = array 1 2 3\nB = array 0 0 0\nfor V Index in A\n B Index += V\n for W in A\n  B Index += W\n end\nend',
        'A = array 1 2 3\nB = array 0 0 0\nfor V Index in A\n B Index += V\n if V equal 2\n  break\n end\nend',
        'A = array 1 2 3\nB = array 0 0 0\nfor V Index in A\n B Index += V\n Bad = 7 // (2 - V)\nend',
    ])('keeps array writes private during a separate vector traversal: %s', source => {
        expect(compare(source).numberLoops).toBe(1);
    });

    it.each(['A', 'A reverse'])('replays private vector writes after scalar overflow: %s', traversal => {
        const source = `use sequences\nA = array 1 2 3\nB = array 0 0 0\nS = 9007199254740990\nfor V Index in ${traversal}\n B Index += V\n S += V\nend`;
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('retains iterator snapshot semantics when writing its own binding', () => {
        const source = 'A = array 1 2 3\nS = 0\nfor V in A\n A 2 = 10\n S += V\nend';
        expect(compare(source).numberLoops).toBe(0);
    });

    it.each([
        'A = array 1 2 3\nB = array 0 0 0\nS = 0\nfor V Index in A reverse\n B Index = V\n S = S * 10 + V\nend',
        'A = array 1 2 3\nB = A\nfor V Index in (A) reverse\n B Index = V\nend',
        'A = array 1 2 3\nB = array 0 0 0\nfor V Index in A reverse\n for W in A reverse\n  B Index += V * W\n end\nend',
        'A = array 1 2 3\nB = array 0 0 0\nfor V Index in A reverse\n B Index = V\n Bad = 7 // (V - 2)\nend',
        'A = array shape 0 fill 0\nB = array 0\nfor V Index in A reverse\n B 0 = V\nend',
    ])('compiles reversed vector traversal with ordinary COW and error behavior: %s', source => {
        expect(compare(`use sequences\n${source}`).numberLoops).toBe(1);
    });

    it('keeps reversed traversal on a snapshot when writing its own binding', () => {
        const source = 'use sequences\nA = array 1 2 3\nS = 0\nfor V in A reverse\n A 0 = 10\n S += V\nend';
        expect(compare(source).numberLoops).toBe(0);
        expect(execute(source).observation.variables).toContainEqual(['S', '6']);
    });

    it('rechecks the reverse builtin before entering a cached vector loop', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = array 1 2 3\nfun work\n S = 0\n for V in A reverse\n  S = S * 10 + V\n end\n return S\nend');
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(321n);
            expect(diagnostics.numberLoops).toBe(1);
            runtime.execute('fun X replacement\n return X\nend');
            runtime.variables.set('reverse', runtime.variables.get('replacement')!);
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(123n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('publishes preceding vector assignments at the original error location', () => {
        const source = 'A = array 1 2 3\nS = 0\nfor V Index in A\n S += V\n Bad = 7 // (2 - V)\nend';
        expect(execute(source).observation.error).toContain('division by zero');
        expect(compare(source).numberLoops).toBe(1);
    });

    it('replays overflowing vector regions from their original scalar inputs', () => {
        const diagnostics = compare('A = array 1 2 3\nS = 9007199254740990\nfor V Index in A\n S += V\nend');
        expect(diagnostics.numberLoops).toBe(2);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        'A = array shape 0 fill 0\nV = "kept"\nfor V Index in A\n Unused = 1\nend',
        'A = array shape 0 fill 0\nIndex = "held"\nfor V Index in A\n Unused = 1\nend',
        'A = array 1 2\nV = "held"\nfor V in A\n Before = 1\nend',
        'A = array 1 9007199254740992\nS = 0\nfor V in A\n S += V\nend',
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

    it('publishes reversed vector array writes on cancellation and retains shared snapshots', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`use sequences
A = array 1 2 3
B = array 0 0 0
Kept = B
Total = 0
Done = 0
try
 for V in A reverse
  for I in 1 to 1000000
   B 0 += V
   Total += V
  end
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            expect(diagnostics.numberLoops).toBe(1);
            expect(runtime.variables.get('Done')).toBe(1n);
            const total = runtime.variables.get('Total') as bigint;
            expect(total).toBeGreaterThan(0n);
            expect(total).toBeLessThan(3000000n);
            expect(runtime.execute('B 0')).toBe(total);
            expect(runtime.execute('Kept 0')).toBe(0n);
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
    ])('retains the existing backend for effects and contracts: %s', source => {
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

    it('publishes mixed scalar and array progress on cancellation and runs finally', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        const initial = 9007199254740993n;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`A = array shape 4096 fill 0
Saved = A
S = ${initial}
Last = 0
Done = 0
try
 for I in 1 to 1000000
  A (I mod 4096) += 1
  S += I
  Last = I
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            const index = runtime.variables.get('Last') as bigint;
            expect(index).toBeGreaterThan(0n);
            expect(runtime.variables.get('S')).toBe(initial + index * (index + 1n) / 2n);
            expect(runtime.execute('A sum')).toBe(index);
            expect(runtime.execute('Saved sum')).toBe(0n);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.mixedIntegerLoops).toBe(1);
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

it('preserves floor division across the bounded fast path and safe-integer limits', () => {
    const numerators: bigint[] = [], denominators: bigint[] = [];
    for (const boundary of [0n, 2n ** 31n, 2n ** 52n, 2n ** 53n - 3n]) {
        for (let delta = -2n; delta <= 2n; delta++) {
            for (const sign of [-1n, 1n]) {
                const a = sign * (boundary + delta);
                for (const b of [1n, -1n, 2n, -2n, 3n, -3n, 127n, -127n, 2n ** 52n - 1n, -(2n ** 53n - 1n)]) {
                    numerators.push(a); denominators.push(b);
                }
            }
        }
    }
    const diagnostics = compare(`A = array ${numerators.join(' ')}
B = array ${denominators.join(' ')}
Q = array shape ${numerators.length} fill 0
for I in 0 till ${numerators.length}
 Q I = A I // B I
end`);
    expect(diagnostics.numberLoops).toBe(1);
    expect(diagnostics.numberLoopOverflows).toBe(0);
});

describe('private fresh integer arrays in Number loops', () => {
    it('reallocates changing shapes and widens cells without losing earlier stores', () => {
        const diagnostics = compare(`A = array 0
Total = 0
for I in 1 to 3
 A = array shape I fill I
 A (I - 1) += 2147483647
 Total += A 0
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it('publishes fresh multidimensional arrays and reads their current shape', () => {
        const diagnostics = compare(`A = array shape 1 2 fill 0
Total = 0
for I in 1 to 3
 A = array shape I 2 fill -2147483649
 A (I - 1) 1 = 9007199254740991
 Total += A 0 0
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it('keeps old aliases and zero-iteration bindings untouched', () => {
        const source = `A = array 10 20
Saved = A
for I in 1 to 0
 A = array shape 3 fill 0
 Fresh = array shape 2 fill 1
end`;
        expect(compare(source).numberLoops).toBe(1);
        expect(execute(source).observation.variables).not.toContainEqual(['Fresh', expect.anything()]);
    });

    it('replaces a binding without mutating its prior snapshot', () => {
        expect(compare(`A = array 10 20
Saved = A
for I in 1 to 3
 A = array shape 2 fill I
 A 0 *= 2
end`).numberLoops).toBe(1);
    });

    it('discards local allocations and existing-array writes before exact overflow replay', () => {
        const diagnostics = compare(`A = array 0
Existing = array 1 2
Saved = Existing
Start = 9007199254740991
for I in 0 to 2
 A = array shape 3 fill I
 A I = I + 1
 Existing 0 += 1
 X = Start + I
end`);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it.each(['-1', '2'])('publishes completed local stores before a bad matrix coordinate %s', index => {
        const diagnostics = compare(`A = array shape 2 2 fill 0
Before = 0
for I in 1 to 2
 A = array shape 2 2 fill I
 A 0 0 = 2147483648
 Before = I
 A 0 (${index}) = 9
 After = I
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it('retains the preceding array when the next allocation has a bad dimension', () => {
        expect(compare(`A = array 5
for I in 0 to 2
 A = array shape (1 - I) fill I
 Done = I
end`).numberLoops).toBe(1);
    });

    it('does not charge fresh buffers against the condition-loop copy budget', () => {
        expect(compare(`A = array 7
I = 0
for I less 2
 A = array shape 262145 fill I
 A I += 1
 I += 1
end`).numberLoops).toBe(1);
    });

    it('replays unsafe fill arithmetic exactly', () => {
        const diagnostics = compare(`A = array 0
Start = 9007199254740991
for I in 0 to 2
 A = array shape 2 fill (Start + I)
end`);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('retains a previous iteration result when continue follows a newer allocation', () => {
        const source = `A = array 0
for I in 1 to 2
 if I equal 2
  A = array shape 2 fill I
  continue
 end
 A = array shape 2 fill I
end`;
        const values = [true, false].map(compilation => {
            const runtime = new Interpreter(() => {}, {compilation});
            try {
                return {result: formatValue(runtime.execute(source)!), current: formatValue(runtime.variables.get('A')!)};
            } finally { runtime.dispose(); }
        });
        expect(values[0]).toEqual(values[1]);
        expect(values[0].result).not.toEqual(values[0].current);
    });

    it('preserves local aliases through the existing COW fallback', () => {
        const source = `A = array 0
Snapshot = array 0
for I in 1 to 2
 A = array shape 2 fill I
 Snapshot = A
 A 0 = 99
end`;
        expect(compare(source).numberLoops).toBe(0);
        expect(execute(source).observation.variables).toContainEqual(['Snapshot', '2 2']);
    });

    it('declines a possibly unassigned local array that needs an entry value', () => {
        expect(compare(`A = array 5 6
Total = 0
for I in 1 to 2
 if I equal 2
  A = array shape 2 fill I
 end
 Total += A 0
end`).numberLoops).toBe(0);
    });

    it('checks an existing binding contract before allocating privately', () => {
        expect(compare(`A = 7
Before = 0
for I in 1 to 2
 Before = I
 A = array shape 2 fill 0
 After = I
end`).numberLoops).toBe(0);
    });

    it('publishes the current local array and completed scalar progress on cancellation', () => {
        const source = `A = array 0 0
Last = -1
Done = 0
try
 for I in 0 to 1000000
  A = array shape 2 fill I
  A 0 += 2147483648
  Last = I
 end
finally
 Done = 1
end`;
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(source)))).toThrow('Interrupted');
            const last = runtime.variables.get('Last') as bigint;
            expect(last).toBeGreaterThanOrEqual(0n);
            expect(runtime.execute('A 0')).toBe(last + 2147483648n);
            expect(runtime.execute('A 1')).toBe(last);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
});
