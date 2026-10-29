import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics();
    let compiledCode = '';
    const runtime = new Interpreter(() => {}, {
        scalarEntryCompilation: false,
        onIntegerLoopCompiled: (code: string) => { compiledCode = code; },
        ...options,
    });
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return {
            diagnostics,
            compiledCode,
            observation: {
                error,
                variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]),
            },
        };
    } finally { runtime.dispose(); }
}

function compare(source: string, negativeRead = false) {
    const candidate = execute(source);
    const reference = execute(source, { compilation: false });
    if (negativeRead) reference.observation.error = reference.observation.error?.replace(/(axis \d+): -1/, '$1');
    expect(candidate.observation).toEqual(reference.observation);
    expect(candidate.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    return candidate;
}

describe('loop-invariant code motion, strength reduction, and bounds check elimination (#469)', () => {
    describe('1D Bounds Check Elimination (BCE)', () => {
        it('elides per-iteration bounds checks in 0 till (A len) loops', () => {
            const candidate = compare(`A = array 10 20 30 40 50
for I in 0 till (A len)
 A I = (A I) * 2
end`);
            expect(candidate.observation.error).toBeUndefined();
            expect(candidate.diagnostics.numberLoops).toBe(1);
            expect(candidate.compiledCode).toContain('bce_');
            expect(candidate.compiledCode).toContain('cells');
        });

        it('elides per-iteration bounds checks in 0 to N - 1 loops', () => {
            const candidate = compare(`N = 5
A = array 1 2 3 4 5
for I in 0 to (N - 1)
 A I += 10
end`);
            expect(candidate.observation.error).toBeUndefined();
            expect(candidate.diagnostics.numberLoops).toBe(1);
            expect(candidate.compiledCode).toContain('bce_');
        });

        it('falls back to exact error when loop range exceeds array bounds', () => {
            const candidate = compare(`A = array 1 2 3
Before = 0
for I in 0 to 5
 Before = I
 A I = I * 10
end`);
            expect(candidate.observation.error).toContain('out of bounds on axis 0: 3');
            expect(candidate.diagnostics.numberLoops).toBe(1);
        });

        it('preserves exact negative index error on negative start', () => {
            const candidate = compare(`A = array 1 2 3
Before = 99
for I in -2 till 3
 Before = I
 A I = I
end`);
            expect(candidate.observation.error).toContain('axis 0');
            expect(candidate.diagnostics.numberLoops).toBe(1);
        });
    });

    describe('2D Nested Loops, LICM and Row Offset Hoisting', () => {
        it('hoists outer coordinate bounds check and row offset calculation in 2D loops', () => {
            const candidate = compare(`A = array shape 3 4 fill 0
for I in 0 till 3
 for J in 0 till 4
  A I J = I * 10 + J
 end
end`);
            expect(candidate.observation.error).toBeUndefined();
            expect(candidate.diagnostics.numberLoops).toBe(1);
            expect(candidate.compiledCode).toContain('rowBase_');
            expect(candidate.compiledCode).toContain('bce_');
        });

        it('computes 2D matrix multiplication with row offset hoisting and BCE', () => {
            const candidate = compare(`A = array shape 2 3 fill 1
B = array shape 3 2 fill 2
C = array shape 2 2 fill 0
for I in 0 till 2
 for J in 0 till 2
  for K in 0 till 3
   C I J += (A I K) * (B K J)
  end
 end
end`);
            expect(candidate.observation.error).toBeUndefined();
            expect(candidate.diagnostics.numberLoops).toBe(1);
            expect(candidate.compiledCode).toContain('rowBase_');
        });

        it('preserves outer-axis out-of-bounds error and preceding completed iterations', () => {
            const candidate = compare(`A = array shape 2 3 fill 0
for I in 0 to 4
 for J in 0 till 3
  A I J = I * 10 + J
 end
end`);
            expect(candidate.observation.error).toContain('out of bounds on axis 0: 2');
            expect(candidate.diagnostics.numberLoops).toBe(1);
        });

        it('preserves inner-axis out-of-bounds error at the exact iteration', () => {
            const candidate = compare(`A = array shape 2 3 fill 0
for I in 0 till 2
 for J in 0 to 5
  A I J = I * 10 + J
 end
end`);
            expect(candidate.observation.error).toContain('out of bounds on axis 1: 3');
            expect(candidate.diagnostics.numberLoops).toBe(1);
        });

        it('hoists base offsets across 3D cube loops', () => {
            const candidate = compare(`Cube = array shape 2 3 4 fill 0
for I in 0 till 2
 for J in 0 till 3
  for K in 0 till 4
   Cube I J K = I * 100 + J * 10 + K
  end
 end
end`);
            expect(candidate.observation.error).toBeUndefined();
            expect(candidate.diagnostics.numberLoops).toBe(1);
            expect(candidate.compiledCode).toContain('rowBase_');
            expect(candidate.compiledCode).toContain('bce_');
        });

        it('handles Gaussian elimination with row offset hoisting', () => {
            const candidate = compare(`Nn = 3
A = array shape 3 4 fill 1.0
A 0 0 = 2.0
A 0 1 = 1.0
A 0 2 = -1.0
A 0 3 = 8.0
A 1 0 = -3.0
A 1 1 = -1.0
A 1 2 = 2.0
A 1 3 = -11.0
A 2 0 = -2.0
A 2 1 = 1.0
A 2 2 = 2.0
A 2 3 = -3.0
for C in 0 till Nn
 Pv = A C C
 for R in (C + 1) till Nn
  F = (A R C) / Pv
  for J in C to Nn
   A R J -= F * (A C J)
  end
 end
end`);
            expect(candidate.observation.error).toBeUndefined();
            expect(candidate.diagnostics.numberLoops).toBe(1);
            expect(candidate.compiledCode).toContain('rowBase_');
        });
    });

    describe('Row caching in BigInt prepareMatrixArrayReader', () => {
        it('traverses matrices correctly when numberLoopCompilation is disabled', () => {
            const result = execute(`A = array shape 3 4 fill 5
Sum = 0
for I in 0 till 3
 for J in 0 till 4
  Sum += A I J
 end
end`, { numberLoopCompilation: false });
            expect(result.observation.error).toBeUndefined();
            const sumVar = result.observation.variables.find(([name]) => name === 'Sum');
            expect(sumVar?.[1]).toBe('60');
        });
    });
});
