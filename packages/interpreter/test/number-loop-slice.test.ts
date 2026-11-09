import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

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
    it.each(['=', '+=', '-=', '*=', '//='])('compiles matrix slices with %s', op => {
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

    it.each(['+', '-', '*', '//', 'mod'])('fuses a discarded slice transform with %s', operator => {
        // Parentheses distinguish RHS remainder from the modular-write suffix.
        const rhs = operator === 'mod' ? '(A Slots mod (I + 2))' : `A Slots ${operator} (I + 2)`;
        const result = compare(`A = array 2 4 6 8 10 12
Alias = A
for I in 1 to 2
 Slots = 0 to 4 by 2
 A Slots -= ${rhs}
 Done = I
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(0);
        expect(result.state.variables).toContainEqual(['Alias', '2 4 6 8 10 12']);
        if (operator === 'mod') expect(result.state.variables).toContainEqual(['A', '0 4 4 8 8 12']);
    });

    it('uses a later statement or explicit return as a discarded-result proof', () => {
        for (const tail of ['', ' Done = 1\n']) {
            const result = compare(`fun Count alter
 A = array shape 6 fill 6
 for I in 1 to Count
  Slots = 0 to 4 by 2
  A Slots -= A Slots // 2
 end
${tail} return A
end
Values = 2 alter`);
            expect(result.diagnostics.numberLoops).toBe(1);
            expect(result.diagnostics.numberLoopSliceDirectCells).toBe(6);
        }
    });

    it('uses floor division on strided scalar and vector compound writes', () => {
        const result = compare(`A = array -9 -8 -7 -6 -5 -4
B = array 2 -3 4
for I in 1 to 2
 A (5 to 1 by -2) //= -2
 A (0 to 4 by 2) //= B (0 to 2)
 Done = I
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('snapshots overlapping transformed source values', () => {
        const result = compare(`A = array 2 4 6 8 10 12
for I in 1 to 2
 A (1 to 5) = A (0 to 4) // 2
 Done = I
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(2);
    });

    it.each([
        'A (0 to 3) //= B (0 to 3)',
        'A (0 to 3) -= A (0 to 3) // (2 - I)',
        'A (0 to 3) = A (0 to 3) mod (2 - I)',
        'A (99 till 0) //= 0',
        'A (99 till 0) -= A (99 till 0) // 0',
        'A (99 till 0) -= A (99 till 0) // (1 // 0)',
        'A (0 to 3) -= A (0 to 2) // 2',
        'A (0 to 4) //= 0',
    ])('preserves division errors, empty selections and preceding writes: %s', statement => {
        compare(`A = array 10 20 30 40
B = array 1 2 0 4
Count = 0
for I in 1 to 2
 Count += 1
 A 0 += 1
 ${statement}
 Done = I
end`, false);
    });

    it('keeps an escaping transformed RHS fresh', () => {
        const result = compare(`A = array 2 4 6 8 10 12
for I in 1 to 2
 A (0 to 4 by 2) -= A (0 to 4 by 2) // 2
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.result).toBe('0 1 2');
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
        // Both numeric tiers retain checked cells and replay this store.
        expect(result.diagnostics.numberLoopOverflows).toBe(2);
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

    it.each(['=', '+=', '-=', '*=', '//='])('retains publishing execution for an overlapping live result with %s', op => {
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
        // Both numeric tiers retain checked cells and replay this store.
        expect(result.diagnostics.numberLoopOverflows).toBe(2);
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

    it('allows a discarded selection before later source writes and continue', () => {
        const result = compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
for I in 0 to 1
 A I (0 to 2) += B I (0 to 2)
 if I equal 1
  B 0 0 = 99
  continue
 end
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.result).toBeUndefined();
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

    it.each([
        ['3 to 5', '0 to 2'],
        ['0 to 4 by 2', '1 to 5 by 2'],
        ['4 to 0 by -2', '1 to 5 by 2'],
    ])('borrows disjoint selections in one mutable array: %s / %s', (target, source) => {
        const result = compare(`A = array 1 2 3 4 5 6
for I in 0 to 1
 A (${target}) += A (${source})
 Done = I
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(0);
        expect(result.diagnostics.numberLoopSliceDirectCells).toBe(6);
    });

    it('borrows independent input buffers while retaining the returned live operand', () => {
        const result = compare(`A = array shape 2 3 fill 1
B = array shape 2 3 fill 2
for I in 0 to 1
 A I (0 to 2) += B I (0 to 2)
end`);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(0);
        expect(result.diagnostics.numberLoopSliceDirectCells).toBe(6);
        expect(result.state.result).toBe('2 2 2');
    });

    it.each(['=', '+=', '-=', '*='])('snapshots overlapping operands even when the result is discarded: %s', op => {
        const result = compare(`A = array 1 2 3 4 5 6
for I in 0 to 1
 A (1 to 5) ${op} A (0 to 4)
 Done = I
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(2);
        expect(result.diagnostics.numberLoopSliceCopyCells).toBe(10);
    });

    it('keeps snapshots for intersecting selections with different strides', () => {
        const result = compare(`A = array 1 2 3 4 5 6 7 8
for I in 0 to 1
 A (0 to 4 by 2) += A (1 to 7 by 3)
 Done = I
end`);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(2);
        expect(result.diagnostics.numberLoopSliceCopyCells).toBe(6);
    });

    it('retains borrowed source cells while the destination widens', () => {
        const result = compare(`A = array shape 6 fill 2000000000
for I in 0 to 1
 A (0 to 4 by 2) += A (1 to 5 by 2)
 Done = I
end`);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(0);
        expect(result.state.variables).toContainEqual(['A', '6000000000 2000000000 6000000000 2000000000 6000000000 2000000000']);
    });

    it('keeps a loop result observable across its compilation boundary', () => {
        const result = compare(`A = array 1 2 3 4 5 6
for I in 0 to 1
 A (1 to 5) += A (0 to 4)
end
Answer = A sum`);
        // Following source statements do not run inside this region: a caller
        // can execute the loop alone and retain its live RHS selection.
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it.each(['continue', 'break'])('retains the last completed iteration result before %s', control => {
        const result = compare(`A = array 1 2 3 4 5 6
for I in 0 to 2
 A (0 to 4 by 2) += A (1 to 5 by 2)
 if I equal 2
  ${control}
 end
 Done = I
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.result).toBe('1');
    });

    it('borrows local slices in a function prefix and publishes the final array', () => {
        const result = compare(`fun work
 A = array shape 6 fill 1
 for I in 0 to 1
  A (0 to 4 by 2) += A (1 to 5 by 2)
  Done = I
 end
 return A
end
Answer = work`);
        expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
        expect(result.diagnostics.numberLoopSliceCopies).toBe(0);
        expect(result.state.variables).toContainEqual(['Answer', '3 1 3 1 3 1']);
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


describe('private boolean range fills', () => {
    it.each(['true', 'false', 'Step equal 2'])('compiles dynamic-stride boolean fills with %s', value => {
        const result = compare(`Flags = array shape 13 fill true
Saved = Flags
for Step in 1 to 3
 Flags (Step to 12 by Step) = ${value}
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.variables).toContainEqual(['Saved', Array(13).fill('true').join(' ')]);
    });
    it.each(['5 to 1 by -2', '3 till 3', '9 till 0', '0 till 5 by -1'])('preserves scalar results for the range %s', range => {
        const result = compare(`Flags = array shape 6 fill false
for I in 0 to 1
 Flags (${range}) = true
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.state.result).toBe('true');
    });
    it('fills rows of a tensor and snapshots its own boolean scalar', () => {
        const result = compare(`Flags = array shape 2 2 6 fill true
Saved = Flags
for I in 0 to 1
 Flags I 1 (5 to 1 by -2) = Flags I 1 0
 Flags I 1 0 = false
end`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each([
        'Flags (0 to 2 by 0) = true',
        'Flags (0 to 8) = true',
        'Flags (8 to 1 by -1) = true',
        'Flags (0 to 2 by 0) = 1 // 0 equal 0',
        'Flags (9 till 0) = 1 // 0 equal 0',
        'Flags (0 to 2) = 0',
    ])('replays boolean range errors in order: %s', statement => {
        compare(`Flags = array shape 6 fill false
Count = 0
for I in 1 to 2
 Count += 1
 ${statement}
end`, false);
    });
});

it.each([1,5,20,100])('retains exact-backend demand-budget observations for boolean range fills, budget=%s', budget=>{
    const bounded=(numberLoopCompilation:boolean)=>{
        const runtime=new Interpreter(()=>{}, {compilation:true,numberLoopCompilation,scalarEntryCompilation:false});
        let error:string|undefined;
        try {try {withDemandBudget(budget,()=>runtime.execute(`Flags = array shape 8 fill true
Count = 0
for I in 1 to 3
 Count += 1
 Flags (I to 7 by I) = false
end`));}
            catch(failure){error=failure instanceof RankError?failure.format():String(failure);}
            return {error,variables:[...runtime.variables].map(([name,value])=>[name,formatValue(value)])};
        }finally{runtime.dispose();}
    };
    expect(bounded(true)).toEqual(bounded(false));
});
