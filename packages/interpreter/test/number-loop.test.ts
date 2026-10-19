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
    it('runs scalar arithmetic on Number without changing the integer value domain', () => {
        const source = 'S = 0\nfor I in 1 to 1000\n S += I mod 7 * 3 + 1\nend';
        const diagnostics = compare(source);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.compiledLoops).toBe(1);
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

    it('uses invocation-owned numeric buffers for eager read-only arrays', () => {
        const diagnostics = compare('A = array 1 2 3\nS = 0\nfor I in 0 to 2\n for J in 0 to I\n  S += A J\n end\nend');
        expect(diagnostics.numberLoops).toBe(1);
    });

    it('declines arrays with unsafe cells before publishing any scalar', () => {
        const diagnostics = compare('A = array 1 9007199254740992\nS = 0\nfor I in 0 to 1\n S += A I\nend');
        expect(diagnostics.numberLoops).toBe(0);
    });

    it.each([
        'A = array 0 0\nfor I in 0 to 1\n A I += 1\nend',
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
