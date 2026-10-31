import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';
import { denseScalarItems } from '../src/array-storage.js';

function execute(source: string, compilation = true, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined, result: string | undefined, resultType: string | undefined;
        try {
            const value = diagnostics.run(() => runtime.execute(source));
            result = value === undefined ? undefined : formatValue(value);
            resultType = typeof value;
        } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { result, resultType, error,
            shapes: [...runtime.variables].filter(([, value]) => isRankArray(value)).map(([name, value]) => [name, isRankArray(value) ? value.shape : []]),
            scalars: [...runtime.variables].filter(([, value]) => typeof value === 'bigint' || typeof value === 'number').map(([name, value]) => [name, typeof value, Object.is(value, -0)]),
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source);
    expect(result.observation).toEqual(execute(source, false).observation);
    expect(result.observation).toEqual(execute(source, true, false).observation);
    return result;
}

describe('private numeric vector stages', () => {
    it.each([
        [[2, 3], [3]],
        [[2, 1], [1, 3]],
        [[2, 1, 3], [4, 1]],
        [[2, 0, 3], [1, 3]],
        [[2, 3], [2, 3]],
    ])('retains native integer kernels for shapes %j and %j', (left, right) => {
        const array = (shape: number[]) => `(1 to ${shape.reduce((a, b) => a * b, 1)}) reshape ${shape.join(' ')}`;
        const r = compare(`use sequences
A = ${array(left)}
B = ${array(right)}
C = A
Total = 0
for I in 1 to 3
 C = (A + B) * I - A
 Total += C sum
end
C`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(0);
    });

    it('joins multidimensional gcd and arithmetic stages in a numeric region', () => {
        const r = compare(`use numbers
use sequences
A = (1 to 6) reshape 2 3
B = array 2 3 4
C = A
Total = 0
for I in 1 to 3
 C = (A gcd B) * I
 Total += C sum
end
C`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it.each([
        [[2, 3], [3]],
        [[2, 1], [1, 3]],
        [[2, 1, 3], [4, 1]],
        [[2, 3], [2, 3]],
    ])('broadcasts real shapes %j and %j without integer conversion', (left, right) => {
        const array = (shape: number[], fill: string) => `array shape ${shape.join(' ')} fill ${fill}`;
        const r = compare(`A = ${array(left, '1.25')}
B = ${array(right, '2.5')}
C = A
Total = 0.0
for I in 1 to 3
 C = (A + B) / (I + 0.5) - A * B
 Total += C sum
end
C`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
        expect(r.diagnostics.compiledTensors).toBe(0);
    });

    it('preserves left-to-right real sum order', () => {
        const r = compare(`A = array 10000000000000000.0 1.0 -10000000000000000.0 2.0
Total = 0.0
for I in 1 to 2
 Total += (A + 0.0) sum
end`);
        expect(r.observation.variables).toContainEqual(['Total', '4']);
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('broadcasts varying integer and real cells without reassociation', () => {
        const r = compare(`use sequences
A = (1 to 24) reshape 2 4 3
B = (array 0.125 -0.75 1.5 2.25) reshape 4 1
C = array shape 2 4 3 fill 0.0
Total = 0.0
for I in 1 to 3
 C = (A - B) / (A + B) + B
 Total += C sum
end
C`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
        expect(r.diagnostics.compiledTensors).toBe(0);
    });

    it('preserves negative zero when publishing real arrays', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`A = array -0.0 0.0
C = A
for I in 1 to 3
 C = A * (I + 0.0)
end`));
            const value = runtime.variables.get('C');
            if (value === undefined || !isRankArray(value)) throw new Error('expected real array');
            const cells = denseScalarItems(value);
            expect(Object.is(cells?.[0], -0)).toBe(true);
            expect(Object.is(cells?.[1], 0)).toBe(true);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('allocates fresh real matrices as real storage even with an integral fill', () => {
        const r = compare(`C = array shape 2 3 fill 0.0
for I in 1 to 3
 C = array shape 2 3 fill 0.0
 C 1 2 = I / 2.0
end
C`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('retains nonfinite real results and replays multidimensional integer overflow', () => {
        const real = compare(`A = array shape 2 3 fill 1.0e308
C = A
for I in 1 to 2
 C = A * I - A * I
end
C`);
        expect(real.observation.error).toBeUndefined();
        expect(real.diagnostics.numberLoops).toBe(1);
        const integer = compare(`use numbers
A = array shape 2 3 fill 9007199254740991
C = A
for I in 1 to 2
 C = (A gcd A) * 3
end
C`);
        expect(integer.observation.error).toBeUndefined();
        expect(integer.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('filters real arrays and retains aliases across pooled allocations', () => {
        const r = compare(`A = array -0.0 -2.5 1.25 4.0
Saved = array 0.0
Total = 0.0
for I in 1 to 8
 C = A filter (A at least 0.0)
 if I equal 1
  Saved = C
 end
 D = C / (I + 0.5)
 Total += D sum
end
Saved`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('replays empty real reductions with the integer identity type', () => {
        const r = compare(`A = array shape 2 0 3 fill 1.5
for I in 1 to 2
 Total = (A + 0.5) sum
end`);
        expect(r.observation.error).toBeUndefined();
        expect(r.observation.resultType).toBe('bigint');
        expect(r.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it.each([
        ['2 3', '3 2', '(A + B) sum'],
        ['2 3', '3 2', '(A / Z + B) sum'],
        ['2 3', '2 3', '(A / Z + B) sum'],
    ])('preserves real error order for shapes %s, %s and %s', (left, right, expression) => {
        const r = compare(`A = array shape ${left} fill 1.5
B = array shape ${right} fill 2.5
Z = array shape 2 3 fill 0.0
Before = 0
Total = 0.0
for I in 1 to 2
 Before = I
 Total += ${expression}
end`);
        expect(r.observation.error).toBeDefined();
    });

    it('matches scalar domain-error timing within vector reductions', () => {
        const r = compare(`use numbers
A = array shape 2 3 fill 1.5
Z = array shape 2 3 fill 0.0
Total = 0.0
for I in 1 to 2
 Total += (A / Z + ((-1) isqrt + 0.0)) sum
end`);
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('joins dynamic ranges, native gcd masks, arithmetic bindings and division sums', () => {
        const r = compare(`use numbers
Total = 0
for U in 1 to 9 by 2
 Vs = 1 to (12 - U) array
 Vs = Vs filter (Vs gcd U equal 1)
 Qa = U * U + 4 * U * Vs + 2 * Vs * Vs
 Qb = Qa + U * U + 2 * Vs * Vs
 Total += (2 * (500 // Qa) + 500 // Qb) sum
end`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
        expect(r.diagnostics.compiledTensors).toBe(0);
        expect(r.diagnostics.maskMaterializations).toBe(0);
    });

    it.each(['1 to 8', '7 to -3 by -2', '1 till 1', '5 to 1'])('materializes %s and handles singleton/empty broadcasts', range => {
        const r = compare(`A = array 0
B = array 2
Total = 0
for I in 1 to 3
 A = ${range} array
 A = A filter (A greater 0)
 Total += ((A + B) * I) sum
end`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('accepts an eager boolean mask and preserves filtered source order', () => {
        const r = compare(`Mask = array true false true false
A = array 0
for I in 1 to 3
 A = I to (I + 3) array
 A = A filter Mask
end
A`);
        expect(r.observation.result).toBe('3 5');
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('reduces ordinary vector arithmetic without intermediate tensors', () => {
        const r = compare(`A = array -3 2 5 8
B = array 7 -2 3 4
Total = 0
for I in 1 to 5
 Total += ((A + I) * B) sum
end`);
        expect(r.observation.variables).toContainEqual(['Total', '290']);
        expect(r.diagnostics.numberLoops).toBe(1);
        expect(r.diagnostics.compiledTensors).toBe(0);
    });

    it.each(['(A // B) sum', '(A + B) sum'])('checks empty-vector broadcasts for %s', expression => {
        const r = compare(`A = 0 till 0 array
B = array 0
Total = 0
for I in 1 to 2
 Total += ${expression}
end`);
        expect(r.observation.error).toBeUndefined();
        expect(r.observation.variables).toContainEqual(['Total', '0']);
    });

    it.each([0, 2147483646])('retains an old array through aliases after pooled widening, base %s', base => {
        const r = compare(`Saved = array 0
A = array 0
Total = 0
for I in 1 to 20
 A = (${base} + I) to (${base} + I + 3) array
 if I equal 1
  Saved = A
 end
 B = A * I
 Total += B sum
end
Saved`);
        expect(r.observation.result).toBe(Array.from({length: 4}, (_, i) => base + i + 1).join(' '));
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('keeps completed ordinary bindings independent of later input rebinding', () => {
        const r = compare(`A = array 0
B = array 0
Total = 0
for I in 1 to 8
 A = 1 to I array
 B = A * 3
 A = A + 100
 Total += (B + A) sum
end
B`);
        expect(r.observation.result).toBe('3 6 9 12 15 18 21 24');
        expect(r.diagnostics.numberLoops).toBe(1);
    });

    it('retains the existing fallback for a rebound vector source read at entry', () => {
        const r = compare(`A = array 0 0
B = array 0 0
C = array 0 0
for I in 1 to 6
 A = B
 B = B + 1
 C = B * 2
end
A`);
        expect(r.observation.result).toBe('5 5');
        expect(r.diagnostics.numberLoops).toBe(0);
    });

    it('widens private int32 vectors without truncating earlier cells', () => {
        const r = compare(`A = array 0
B = array 0
for I in 1 to 3
 A = 2147483646 to 2147483650 array
 B = A * I
end
B`);
        expect(r.observation.result).toBe('6442450938 6442450941 6442450944 6442450947 6442450950');
        expect(r.diagnostics.numberLoops).toBe(1);
        expect(r.diagnostics.numberLoopOverflows).toBe(0);
    });

    it('replays unsafe arithmetic exactly without duplicating prior accumulation', () => {
        const r = compare(`Total = 0
for I in 1 to 2
 A = 9007199254740989 to 9007199254740991 array
 Total += (A * 3) sum
end`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it.each([
        '(A // B + C // D) sum',
        '(A // B + C * D) sum',
        '(A + C) sum',
        '(A mod B) sum',
    ])('preserves exact error order and completed state for %s', expression => {
        compare(`A = array 10 20
B = array 2 0
C = array 5 6 7
D = array 0 1 1
Before = 0
Total = 0
for I in 1 to 2
 Before = I
 Total += ${expression}
end`);
    });

    it('replays invalid range steps with the ordinary error contract', () => {
        const r = compare(`Before = 0
for I in 1 to 2
 Before = I
 A = 1 to 4 by 0 array
end`);
        expect(r.observation.error).toBeDefined();
    });

    it('does not materialize a range owned by a native reduction consumer', () => {
        const r = compare(`Total = 0
for I in 1 to 2
 Total += (1 to 1000) sum
end`);
        expect(r.observation.variables).toContainEqual(['Total', '1001000']);
        expect(r.diagnostics.numberLoops).toBe(0);
    });

    it('does not distribute a user function named gcd over vector cells', () => {
        const r = compare(`fun A gcd B
 return A - B
end
Total = 0
for U in 2 to 2
 Vs = 1 to 3 array
 Vs = Vs filter (Vs gcd U equal 1)
 Total += Vs sum
end`);
        expect(r.observation.variables).toContainEqual(['Total', '3']);
        expect(r.diagnostics.numberLoops).toBe(0);
    });

    it('does not force an unused deferred binding', () => {
        const r = compare(`Total = 0
for I in 1 to 2
 A = 1 to 3 array
 Bad' = A // 0
 Total += A sum
end`);
        expect(r.observation.error).toBeUndefined();
        expect(r.observation.variables).toContainEqual(['Total', '12']);
        expect(r.diagnostics.numberLoops).toBe(0);
    });

    it.each([70, 110, 170, 333])('publishes only complete array bindings under budget %s', budget => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('A = array 0\nB = array 0\nRound = 0');
            expect(() => withDemandBudget(budget, () => diagnostics.run(() => runtime.execute(`for I in 1 to 100
 Round = I
 A = I to (I + 7) array
 B = A + I
end`)))).toThrow(DemandBudgetExhausted);
            const round = Number(runtime.variables.get('Round'));
            const b = formatValue(runtime.variables.get('B')!);
            const complete = (n: number) => Array.from({length: 8}, (_, i) => 2 * n + i).join(' ');
            expect(['0', complete(round), complete(round - 1)]).toContain(b);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
});
