import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';

function execute(source: string, mode = 'number') {
    const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference',
        numberLoopCompilation: mode !== 'exact', scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined, result: string | undefined;
        try {
            const value = diagnostics.run(() => runtime.execute(source));
            if (value !== undefined) result = formatValue(value);
        }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { error, result,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, success = true) {
    const result = execute(source);
    expect(result.state).toEqual(execute(source, 'reference').state);
    expect(result.state).toEqual(execute(source, 'exact').state);
    if (success) expect(result.state.error).toBeUndefined();
    return result;
}

describe('private integer row-slice writes', () => {
    it.each(['=', '+=', '-=', '*='])('compiles matrix slices with %s', op => {
        const result = compare(`A = array shape 2 6 fill 3
B = array shape 3 5 fill 2
for I in 0 to 1
 A I (1 to 4) ${op} B (I + 1) (0 till 4)
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it.each(['=', '+=', '-=', '*='])('compiles scalar fills with %s and returns the operand', op => {
        const result = compare(`A = array shape 2 6 fill 3
Alias = A
for I in 0 to 1
 A I (5 to 1 by -2) ${op} (I + 2)
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.result).toBe('3');
        expect(result.state.variables).toContainEqual(['Alias', '3 3 3 3 3 3 3 3 3 3 3 3']);
    });

    it('snapshots a scalar read from the destination before filling', () => {
        const result = compare(`A = array 1 2 3 4 5 6
for I in 0 to 1
 A (0 to 5) += A 0
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.variables).toContainEqual(['A', '4 5 6 7 8 9']);
    });

    it('widens local scalar fills past Int32', () => {
        const result = compare(`S = 0
for I in 0 to 1
 A = array shape 2 3 fill 0
 A I (0 till 3) = 3000000000 + I
 S += A I 0
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.variables).toContainEqual(['S', '6000000001']);
    });

    it('replays overflowing compound scalar fills without publishing speculative stores', () => {
        const result = compare(`A = array shape 2 3 fill 9007199254740990
S = 0
for I in 0 to 1
 S += 1
 A I (0 to 2) += 2
end`);
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        'A I (99 till 0) = 7',
        'A I (99 till 0) = 1 // (1 - I)',
        'A I (0 to 3) = 1 // (1 - I)',
        'A I (0 to 2 by 0) = 1 // (1 - I)',
        'A (I + 1) (0 to 2) = 1 // (1 - I)',
    ])('retains scalar selection and operand evaluation ordering: %s', statement => {
        compare(`A = array shape 2 3 fill 0
S = 0
for I in 0 to 1
 S += 1
 ${statement}
end`, false);
    });

    it('supports scalar prefixes of rank three and distinct strides', () => {
        const result = compare(`A = array shape 2 2 6 fill 3
B = array shape 2 2 9 fill 2
for I in 0 to 1
 A I 1 (5 to 1 by -2) += B I 0 (0 to 8 by 4)
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it.each(['=', '+=', '-=', '*='])('retains publishing execution for an overlapping live result with %s', op => {
        const result = compare(`A = array 1 2 3 4 5 6
Alias = A
for I in 0 to 1
 A (1 to 5) ${op} A (0 to 4)
end`);
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it('preserves separate aliases and widens local Int32 cells', () => {
        const result = compare(`B = array shape 2 3 fill 2000000000
Alias = B
S = 0
for I in 0 to 1
 A = array shape 2 3 fill 2000000000
 A I (0 to 2) += B I (0 to 2)
 S += A I 1
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.variables).toContainEqual(['Alias', '2000000000 2000000000 2000000000 2000000000 2000000000 2000000000']);
    });

    it('accepts empty arithmetic ranges without reading their endpoints', () => {
        const result = compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
for I in 0 to 1
 A I (99 till 0) += B I (100 to 0)
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('replays overflow after earlier array and scalar stores', () => {
        const result = compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
B 1 1 = 9007199254740991
S = 0
for I in 0 to 1
 S += 1
 A I 0 += 3
 A I (0 to 2) += B I (0 to 2)
end`);
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        'A I (0 to 3) += B I (0 to 3)',
        'A I (0 to 2) += B I (0 to 1)',
        'A I (0 to 2) += B I (1 to 3)',
        'A I (0 to 2 by 0) += B I (0 to 2)',
        'A (I + 1) (0 to 2) += B I (0 to 2)',
        'A I (0 to 2) += B (I + 1) (0 to 2)',
        'A I (0 to 2) += B I (0 to 2 by 0)',
        'A I (0 to 2) += B I (0 to (2 // (1 - I)))',
    ])('retains selection errors and preceding state: %s', statement => {
        compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
S = 0
for I in 0 to 1
 S += 1
 A I 0 += 10
 ${statement}
end`, false);
    });

    it('publishes successful slices before an ordinary later error', () => {
        const result = compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
for I in 0 to 1
 A I (0 to 2) += B I (0 to 2)
 S = 1 // (1 - I)
end`, false);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('retains a live result when its source is written later in the region', () => {
        const result = compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
for I in 0 to 1
 A I (0 to 2) += B I (0 to 2)
 if I equal 1
  B 0 0 = 99
  continue
 end
end`);
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it('preserves a returned operand after subsequent source and destination writes', () => {
        const observations = ['number', 'reference', 'exact'].map(mode => {
            const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference',
                numberLoopCompilation: mode !== 'exact', scalarEntryCompilation: false });
            try {
                const value = runtime.execute(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
for I in 0 to 1
 A I (0 to 2) += B I (0 to 2)
end`)!;
                const before = formatValue(value);
                runtime.execute('A 1 0 = 98\nB 1 0 = 99');
                return [before, formatValue(value)];
            } finally { runtime.dispose(); }
        });
        expect(observations[0]).toEqual(observations[1]);
        expect(observations[0]).toEqual(observations[2]);
    });

    it('retains fallback for real, boolean and mixed cell arrays', () => {
        for (const value of ['1.5', 'true', '"text"']) {
            compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill ${value}
for I in 0 to 1
 A I (0 to 2) += B I (0 to 2)
end`, false);
        }
    });

    it('keeps named table row selection on the ordinary backend', () => {
        const observations = ['number', 'reference', 'exact'].map(mode => {
            const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference',
                numberLoopCompilation: mode !== 'exact', scalarEntryCompilation: false });
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.execute('A = array shape 2 3 fill 1\nB = array shape 2 3 fill 2');
                Object.defineProperty(runtime.variables.get('B')!, 'columnNames', { value: ['X', 'Y', 'Z'] });
                let error: string | undefined;
                try {
                    diagnostics.run(() => runtime.execute('for I in 0 to 1\n A I (0 to 2) += B I (0 to 2)\nend'));
                } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
                expect(diagnostics.numberLoops).toBe(0);
                return [error, formatValue(runtime.variables.get('A')!)];
            } finally { runtime.dispose(); }
        });
        expect(observations[0]).toEqual(observations[1]);
        expect(observations[0]).toEqual(observations[2]);
    });

    it('copies long operands with polling and keeps the large-store admission policy', () => {
        const result = compare(`A = array shape 2 5000 fill 2000000000
B = array shape 2 5000 fill 2000000000
for I in 0 to 1
 for J in 0 to 1
  A I (0 till 5000) += B I (0 till 5000)
 end
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('publishes completed work and runs finally on cancellation', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array([1]);
        try {
            runtime.execute('A = array shape 2 3 fill 0\nB = array shape 2 3 fill 1\nDone = 0');
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`try
 for I in 0 to 1000000
  A 0 (0 to 2) += B 1 (0 to 2)
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
});
