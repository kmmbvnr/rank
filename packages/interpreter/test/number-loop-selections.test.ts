import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';

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

describe('private numeric indexed selections', () => {
    it.each(['array 3 1 1 0', 'array shape 2 2 fill 1', 'array shape 0 fill 0'])('gathers selector %s with its shape', indices => {
        const r = compare(`use sequences
A = array 10 20 30 40
Ix = ${indices}
Last = 0
Picked = A Ix
for N in 1 to 3
 Picked = A Ix
 A 0 = 9
end
tuple A Picked`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });
    it.each(['array 2 0 2', 'array shape 0 fill 0', 'array shape 1 2 fill 2'])('scatters a scalar through %s', indices => {
        const r = compare(`use sequences
A = array 1 2 3
Ix = ${indices}
Last = 0
for N in 1 to 3
 A Ix = 9
 Last = N
end
tuple A Last`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });
    it.each([
        ['array 2 0 1', 'A', 'A'],
        ['array 0 1 2', 'array 2 0 1', 'A'],
        ['array 4 5 6', 'array 2 2 0', 'array 10 20 30'],
        ['array 1.5 2.5 3.5', 'array 2 0 1', 'A'],
        ['array 0 1 2', 'array shape 1 2 fill 2', 'array shape 1 2 fill 9'],
    ])('snapshots selectors and RHS: %s / %s / %s', (values, indices, rhs) => {
        const r = compare(`use sequences
A = ${values}
Ix = ${indices}
Rhs = ${rhs}
Last = 0
for N in 1 to 1
 A Ix = Rhs
 Last = N
end
tuple A Last`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });
    it.each(['not equal N', 'Seen not equal N', 'Mask'])('searches first index using %s', mask => {
        const r = compare(`Seen = array 1 1 3 4
Mask = array false true false false
Found = 0
for N in 1 to 2
 Found = Seen first index where ${mask}
end
Found`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });
    it.each([
        'Picked = A (array -1 0)', 'Picked = A (array 0 5)',
        'A (array 0 5) = 1 // 0', 'A (array -1 0) = 8',
        'A (array 0 1) = array 8 9 10',
        'Found = A first index where greater 9',
        'Found = A first index where (array true false)',
    ])('replays error after preceding stores: %s', operation => {
        const r = compare(`A = array 1 2 3
for N in 1 to 2
 A 0 += 1
 ${operation}
 Last = N
end`);
        expect(r.observation.error).toBeDefined();
    });
    it.each([
        ['array 0 5', 'Picked = A Ix'],
        ['array -1 0', 'A Ix = 8'],
        ['array 0 5', 'A Ix = 1 // 0'],
        ['array 0 1', 'A Ix = Rhs'],
        ['array 0 1', 'Found = A first index where greater 9'],
        ['array 0 1', 'Found = A first index where Mask'],
    ])('actually enters Number and replays %s / %s', (indices, operation) => {
        const r = compare(`A = array 1 2 3
Ix = ${indices}
Rhs = array 8 9 10
Mask = array true false
Picked = A
Found = 0
Last = 0
for N in 1 to 2
 A 0 += 1
 ${operation}
 Last = N
end`);
        expect(r.observation.error).toBeDefined();
        expect(r.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });
    it('gathers real cells and keeps the old snapshot after writes', () => {
        const r = compare(`A = array 1.5 -2.5 3.5
Ix = array 2 0
Picked = A Ix
for N in 1 to 3
 Picked = A Ix
 A 0 = 8.5
end
tuple A Picked`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });
    it.each([
        'Picked = (A + 10) (Ix + 1)',
        'Picked = (A Ix) + (A (Ix + 1))',
        'A (Ix + 1) = A Ix + 10',
    ])('pins pooled selection operands in %s', operation => {
        const r = compare(`A = array 10 20 30 40
Ix = array 0 1 2
Picked = A Ix
Last = 0
for N in 1 to 3
 ${operation}
 Last = N
end
tuple A Picked`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoops).toBe(1);
    });
    it('retains demand and division error timing in the mask', () => {
        compare(`A = array 1 0
Found = 0
for N in 1 to 2
 Found = A first index where (10 // A greater 1)
end
Found`);
    });
    it('replays overflow and preserves snapshots', () => {
        const r = compare(`A = array 0 1 2
Ix = array 2 0
Saved = A
Picked = A Ix
Last = 0
for N in 1 to 2
 Picked = A Ix
 A Ix = 9007199254740991 + N
 Last = N
end
tuple A Saved Picked`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });
    it('retains the live selection when an assignment result escapes', () => {
        compare(`A = array 1 2 3
Ix = array 0 2
Result = for N in 1 to 2
 A Ix = N
end
tuple Result A`);
    });
});
