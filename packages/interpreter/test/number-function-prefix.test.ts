import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, type InterpreterOptions } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';

const helper = `fun N build
  A = array shape N fill 0
  for I in 0 till N
    A I = I + 1
  end
  Total = 0
  for J in 0 till N
    A J *= 2
    Total += A J
  end
  return Total
end`;
function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics(), output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), options);
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { observation: { value: value === undefined ? undefined : formatValue(value), output }, diagnostics };
    } catch (error) {
        return { observation: { error: error instanceof RankError ? error.format() : String(error), output }, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string, options: InterpreterOptions = {}) {
    const compiled = execute(source, options);
    expect(compiled.observation).toEqual(execute(source, { compilation: false }).observation);
    return compiled;
}

describe('numeric function prefixes with fresh arrays', () => {
    it('keeps two loops and their allocation in one Number region', () => {
        const result = compare(`${helper}\n100 build`);
        expect(result.observation.value).toBe('10100');
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('binds new frames and dimensions on repeated calls, including empty arrays', () => {
        const result = compare(`${helper}\narray (3 build) (0 build) (7 build)`);
        expect(result.observation.value).toBe('12 0 56');
        expect(result.diagnostics.numberLoops).toBe(3);
    });

    it.each(['numberLoopCompilation', 'functionBodyCompilation', 'integerLoopCompilation', 'nestedLoopCompilation', 'arrayLocalCompilation'] as const)(
        'retains ordinary execution with %s disabled', option => {
            compare(`${helper}\n10 build`, { [option]: false });
        });

    it('returns a completed local array and keeps earlier call results independent', () => {
        const source = helper.replace('return Total', 'return A');
        const result = compare(`use sequences\n${source}\nFirst = 3 build\nNext = 2 build\narray (First sum) (Next sum)`);
        expect(result.observation.value).toBe('12 6');
        expect(result.diagnostics.numberLoops).toBe(2);
    });

    it('preserves ordinary completion when an unused expression throws', () => {
        const source = helper.replace('  Total = 0', '  Unused = 1 // 0\n  Total = 0');
        expect(compare(`${source}\n3 build`).observation.error).toContain('division by zero');
    });

    it('preserves deferred, unused errors without computing a plan early', () => {
        const source = helper.replace('  Total = 0', "  Unused' = 1 // 0\n  Total = 0");
        expect(compare(`${source}\n3 build`).observation.value).toBe('12');
    });

    it('retains the error location and call trace in the second loop', () => {
        const source = helper.replace('A J *= 2', 'A J //= N - J - 1');
        expect(compare(`${source}\n3 build`).observation.error).toContain('division by zero');
    });

    it('discards speculative stores before exact replay after scalar overflow', () => {
        const source = helper.replace('A I = I + 1', 'A I = 4503599627370496').replace('A J *= 2', 'A J *= 4');
        const result = compare(`${source}\n3 build`);
        expect(result.observation.value).toBe('54043195528445952');
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('falls back for local aliases without changing snapshot values', () => {
        const source = helper.replace('  Total = 0', '  Snapshot = A\n  Total = 0').replace('return Total', 'return Snapshot');
        expect(compare(`${source}\n3 build`).observation.value).toBe('1 2 3');
    });

    it('retains early returns inside a loop', () => {
        const source = helper.replace('A I = I + 1', 'A I = I + 1\n    if I equal 1\n      return A I\n    end');
        expect(compare(`${source}\n3 build`).observation.value).toBe('2');
    });

    it('rechecks changing scalar captures at entry', () => {
        const source = helper.replace('A J *= 2', 'A J *= Scale');
        expect(compare(`Scale = 2\n${source}\nFirst = 3 build\nScale = 3\narray First (3 build)`).observation.value).toBe('12 18');
    });

    it('falls back for writes to a caller array and preserves its aliases', () => {
        const source = helper.replace('fun N build', 'fun Input build\n  N = Input len').replace('A = array shape N fill 0', 'A = Input');
        expect(compare(`Input = array 0 0 0\nSnapshot = Input\n${source}\nX = Input build\narray X (Snapshot 0) (Input 0)`).observation.value).toBe('12 0 0');
    });

    it('preserves native guards when the compilation observer replaces a builtin', () => {
        const source = helper.replace('A J *= 2', 'A J = A J isqrt');
        let runtime: Interpreter;
        runtime = new Interpreter(() => {}, { onIntegerLoopCompiled() {
            runtime.variables.set('isqrt', { kind: 'function', name: 'isqrt', arities: [1], monadicRank: 'all', call: () => 7n });
        } });
        try {
            expect(runtime.execute(`use numbers\n${source}\n3 build`)).toBe(21n);
        } finally { runtime.dispose(); }
    });

    it('polls a shared cancellation flag and executes the caller finally', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(() => {}, { onIntegerLoopCompiled() { Atomics.store(signal, 0, 1); } });
        try {
            expect(() => withInterrupt(signal, () => diagnostics.run(() => runtime.execute(
                `${helper}\nDone = 0\ntry\n  Answer = 1000000 build\nfinally\n  Done = 1\nend`)))).toThrow('Interrupted');
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(runtime.variables.has('Answer')).toBe(false);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
});
