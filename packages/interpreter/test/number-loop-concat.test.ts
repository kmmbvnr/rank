import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

function observe(source: string, compilation: boolean) {
    const r = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false, scalarFunctionCompilation: false });
    const d = new RuntimeDiagnostics();
    try {
        let error: string | undefined, result: string | undefined;
        try { const value = d.run(() => r.execute(source)); result = value === undefined ? undefined : formatValue(value); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, error, result, state: [...r.variables].map(([name, value]) => [name, formatValue(value)]) };
    } finally { r.dispose(); }
}
function compare(source: string, allowError = false) {
    const expected = observe(source, false), actual = observe(source, true);
    if (!allowError) expect(expected.error).toBeUndefined();
    expect(actual.error).toBe(expected.error);
    expect(actual.result).toBe(expected.result);
    expect(actual.state).toEqual(expected.state);
    return actual.d;
}
const prefix = `use sequences
A = array shape 1 fill 0
Saved = A
Total = 0`;
const grow = `for I in 0 till 100
 if I at least (A len)
  A = concat A A copy
 end
 A I = I + 1
 Total += A I
end`;

describe('completed numeric concatenation in private loops', () => {
    it('grows an entry array repeatedly while retaining its external snapshot', () => {
        const d = compare(`${prefix}\n${grow}`);
        expect(d.numberLoops).toBe(1);
        expect(d.numberLoopOverflows).toBe(0);
    });

    it.each([0, 1, 3])('publishes writes before/after replacement on a later error (I=%s)', stop => {
        const d = compare(`${prefix}
for I in 0 till 5
 if I at least (A len)
  A = concat A A copy
 end
 A 0 += 1
 Total = 10 // (${stop} - I)
end`, true);
        expect(d.numberLoops).toBe(1);
    });

    it('publishes a widened entry buffer when no replacement executes', () => {
        expect(compare(`${prefix}
for I in 0 till 4
 if I greater 100
  A = concat A A copy
 end
 A 0 = 2147483648 + I
 Total += A 0
end`).numberLoops).toBe(1);
    });

    it.each(['A I = I', 'Total += A I'])('checks a later smaller buffer before %s', operation => {
        const d = compare(`use sequences
A = array shape 4 fill 0
B = array 9
Total = 0
for I in 0 till 4
 ${operation}
 if I equal 0
  A = B copy
 end
 Total += 1
end`, true);
        expect(d.numberLoops).toBe(1);
    });

    it('keeps widening and subsequent concatenation in the same private buffer', () => {
        const d = compare(`${prefix}
for I in 0 till 4
 A 0 += 2147483648
 A = concat A A copy
 Total += A 0
end`);
        expect(d.numberLoops).toBe(1);
        expect(d.numberLoopOverflows).toBe(0);
    });

    it('replays overflow without duplicating earlier stores or growth', () => {
        const d = compare(`${prefix}
Total = 9007199254740980
${grow}`);
        expect(d.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('copies several operands without truncating wide safe integer cells', () => {
        const d = compare(`use sequences
A = array 2147483648 -2147483649
B = array 7 8
C = array 9
Total = 0
for I in 0 till 3
 A = concat A B C copy
 Total += A I
end`);
        expect(d.numberLoops).toBe(1);
        expect(d.numberLoopOverflows).toBe(0);
    });

    it('keeps read-only aliases of the entry array separate from its writes', () => {
        compare(`${prefix}
Other = A
for I in 0 till 10
 if I at least (A len)
  A = concat A A copy
 end
 A I = I + 1
 Total += Other 0
end`);
    });

    it('keeps aliases created inside the loop on the existing ownership path', () => {
        compare(`${prefix}
for I in 0 till 5
 Old = A
 A = concat A A copy
 A 0 = I + 1
 Total += Old 0
end`);
    });

    it('keeps an escaping previous iteration result across stores and break', () => {
        const d = compare(`use sequences
A = array shape 1 fill 0
for I in 0 till 4
 A 0 += 1
 if I equal 2
  break
 end
 A = concat A A copy
end`);
        expect(d.numberLoops).toBe(0);
    });

    it.each(['array 0.0 -0.0', 'array 1.5 -2.25'])('preserves real arrays (%s)', values => {
        const d = compare(`use sequences
A = ${values}
Saved = A
Total = 0.0
for I in 0 till 4
 A = concat A A copy
 A 0 += 0.25
 Total += A 0
end`);
        expect(d.numberLoops).toBe(1);
    });

    it('retains multidimensional axis semantics on the evaluator', () => {
        compare(`use sequences
A = array shape 2 2 fill 1
for I in 0 till 2
 A = concat A A axis 1 copy
end`);
    });

    it('retains lazy concatenation snapshots without an explicit copy', () => {
        compare(`use sequences
A = array 1 2
for I in 0 till 2
 B = concat A A
 A 0 = I
end`);
    });

    it('keeps empty loops from replacing an entry array', () => {
        compare(`${prefix}\n${grow.replace('till 100', 'till 0')}`);
    });

    it('does not bypass the sequences module requirement', () => {
        const d = compare(`A = array 1 2
for I in 0 till 2
 A = concat A A copy
end`, true);
        expect(d.numberLoops).toBe(0);
    });

    it('cancels a copy without publishing a partly concatenated array', () => {
        const r = new Interpreter(() => {}, { scalarEntryCompilation: false }), d = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = array shape 64 fill 0\nSaved = A\nDone = 0');
            const flag = new Int32Array(1); flag[0] = 1;
            expect(() => withInterrupt(flag, () => d.run(() => r.execute(`for I in 0 till 10
 A 0 = 7
 A = concat A A copy
 Done += 1
end`)))).toThrow('Interrupted');
            expect(d.numberLoops).toBe(1);
            expect(r.execute('A len')).toBe(64n * 2n ** (r.variables.get('Done') as bigint));
            expect(r.execute('A 0')).toBe(7n);
            expect(r.execute('Saved 0')).toBe(0n);
            expect(r.variables.get('Done')).toBeLessThan(10n);
        } finally { r.dispose(); }
    });

    it('retains publishing boundaries for rebound arrays under a demand budget', () => {
        const r = new Interpreter(() => {}, { scalarEntryCompilation: false }), d = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = array shape 64 fill 0\nSaved = A\nDone = 0');
            expect(() => withDemandBudget(5000, () => d.run(() => r.execute(`for I in 0 till 20
 A 0 = I + 1
 A = concat A A copy
 Done += 1
end`)))).toThrow(DemandBudgetExhausted);
            // Rebound bindings retain observable publication under demand budgets.
            expect(d.numberLoops).toBe(0);
            const done = r.variables.get('Done') as bigint;
            expect(done).toBeGreaterThan(0n);
            expect(done).toBeLessThan(20n);
            expect(r.execute('A len')).toBe(64n * 2n ** done);
            expect(r.execute('A 0')).toBe(done + 1n);
            expect(r.execute('Saved 0')).toBe(0n);
        } finally { r.dispose(); }
    });
});
