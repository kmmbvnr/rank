import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const candidate = execute(source);
    expect(candidate.observation).toEqual(execute(source, { compilation: false }).observation);
    expect(candidate.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    return candidate.diagnostics;
}

describe('integer sums inside compiled loops', () => {
    it.each(['A sum', '(A * B) sum', '(2 * A + B - 1) sum'])('lowers %s without a tensor temporary', expression => {
        const diagnostics = compare(`A = array 1 2 3
B = array 4 5 6
Total = 0
for I in 1 to 3
 Total += ${expression}
end`);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.compiledTensors).toBe(0);
    });
    it.each(['A * B', 'B * A'])('broadcasts a singleton in %s', expression => {
        expect(compare(`A = array 2
B = array 3 4 5
for I in 1 to 2
 Total = (${expression}) sum
end`).numberLoops).toBe(1);
    });
    it.each(['A', 'A * B', 'B * A'])('uses integer zero for empty %s', expression => {
        expect(compare(`A = array shape 0 fill 0
B = array 2
for I in 1 to 2
 Total = (${expression}) sum
end`).numberLoops).toBe(1);
    });
    it.each(['3', '0', '2 3'])('copies private integer storage with shape %s', shape => {
        const d = compare(`use sequences
for I in 1 to 2
 A = array shape ${shape} fill I
 Snapshot = A copy
 A = array shape ${shape} fill 99
 Total = Snapshot len
end`);
        expect(d.numberLoops).toBe(1);
    });
    it('declines a conflicting array rank before any private stores', () => {
        expect(compare(`use sequences
Snapshot = array 0
for I in 1 to 2
 Before = I
 A = array shape 2 3 fill I
 Snapshot = A copy
end`).numberLoops).toBe(0);
    });
    it('checks the rank contract of a fresh allocation as well as a copy', () => {
        expect(compare(`A = array 0
for I in 1 to 2
 Before = I
 A = array shape 2 3 fill 1
end`).numberLoops).toBe(0);
    });
    it('copies a numeric input before later source and destination writes', () => {
        expect(compare(`use sequences
A = array 1 2 9007199254740991
for I in 1 to 2
 Snapshot = A copy
 A 0 = I
 Snapshot 1 = I
end`).numberLoops).toBe(1);
    });
    it('preserves a local snapshot across later stores and a failure', () => {
        compare(`use sequences
for I in 1 to 2
 A = array shape 3 fill I
 Snapshot = A copy
 A 0 = 99
 A 3 = 7
end`);
    });
    it('reduces a freshly allocated local after its stores', () => {
        expect(compare(`Total = 0
for I in 1 to 3
 A = array shape 3 fill I
 A 1 += I
 Total += A sum
end`).numberLoops).toBe(1);
    });
    it('keeps aliased input snapshots separate from writes', () => {
        expect(compare(`A = array 1 2 3
Alias = A
for I in 0 to 2
 A I += 1
 Total = (A * Alias) sum
end`).numberLoops).toBe(1);
    });
    it('replays overflow in a product or partial sum exactly', () => {
        const d = compare(`A = array 9007199254740991 2
B = array 1 2
Before = 0
for I in 1 to 2
 Before = I
 Total = (A * B) sum
end`);
        expect(d.numberLoopOverflows).toBeGreaterThan(0);
        expect(d.compiledLoops).toBeGreaterThan(0);
    });
    it('preserves preceding writes and shape errors', () => {
        compare(`A = array 1 2
B = array 1 2 3
Before = 0
for I in 1 to 2
 Before = I
 Total = (A * B) sum
 After = I
end`);
    });
    it('retains scalar error order even for an empty array', () => {
        compare(`A = array shape 0 fill 0
for I in 1 to 2
 Before = I
 Total = (A * (1 // 0)) sum
end`);
    });
    it('keeps reduction errors behind short-circuit guards', () => {
        expect(compare(`A = array 1 2
B = array 1 2 3
for I in 1 to 2
 Result = false and ((A * B) sum greater 0)
end`).numberLoops).toBe(1);
    });
    it('falls back for real, missing, matrix and lazy inputs', () => {
        for (const value of ['array 1.5 2.5', 'array 1 .NA', 'array shape 2 2 fill 3', '1 to 3']) {
            const source = `A = ${value}
for I in 1 to 2
 Total = A sum
end`;
            expect(execute(source).observation.error).toBeUndefined();
            compare(source);
        }
    });
    it('retains ordinary evaluation for divisions and callable operands', () => {
        for (const expression of ['(A // B) sum', '(A * (I scale)) sum']) {
            compare(`fun X scale
 return X + 1
end
A = array 2 4
B = array 1 2
for I in 1 to 2
 Total = ${expression}
end`);
        }
    });
});
