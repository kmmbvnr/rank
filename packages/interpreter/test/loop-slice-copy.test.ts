import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

function execute(source: string, compilation = true) {
    const runtime = new Interpreter(undefined, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source);
    expect(result.observation).toEqual(execute(source, false).observation);
    return result;
}

describe('range snapshots in compiled loops (#424)', () => {
    it.each(['', ' copy'])('compiles nested stack reduction with an unused or taken slice%s', copy => {
        for (const snapshot of [-1, 70]) {
            const result = compare(`use sequences
N = 140
St = array shape (N + 1) fill 0
Sa = St (0 till 0)
Tp = 0
for J in 0 till N
 if J equal ${snapshot}
  Sa = St (0 till Tp)${copy}
 end
 St Tp = J mod 7
 Tp += 1
 Go = true
 for Go and Tp at least 2
  if St (Tp - 1) greater St (Tp - 2)
   St (Tp - 2) = St (Tp - 1)
   Tp -= 1
  else
   Go = false
  end
 end
end`);
            expect(result.observation.error).toBeUndefined();
            expect(result.diagnostics.compiledLoops).toBe(1);
        }
    });

    it.each(['', ' copy'])('retains snapshots across later source and destination writes%s', copy => {
        const result = compare(`use sequences
A = array shape 32 fill 0
for I in 0 to 9
 A I = I
 Saved = A (0 to I)${copy}
 A 0 = 99
 Saved I = -1
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it.each(['0', '0.0', 'false', '"x"'])('copies numeric, boolean and text cells: %s', fill => {
        const result = compare(`use sequences
A = array shape 8 fill ${fill}
for I in 0 to 2
 Saved = A (1 till 4) copy
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('preserves trailing axes and slices a later axis', () => {
        const result = compare(`use sequences
A = array shape 3 4 fill 7
for I in 0 to 2
 Rows = A (0 to 1)
 Columns = A # (1 till 3) copy
 A I 2 = I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it.each(['2 till 2', '3 to 1', '0 to 8', '-1 till 2'])('keeps empty slices and bounds errors for %s', range => {
        const result = compare(`use sequences
A = array shape 8 fill 0
for I in 0 to 2
 Before = I
 Saved = A (${range}) copy
 After = I
end`);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('falls back when copy is shadowed', () => {
        const result = compare(`fun A copy
 return A
end
A = array shape 8 fill 0
for I in 0 to 2
 Saved = A (0 till 2) copy
 A 0 = I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.compiledLoops).toBe(0);
    });
});
