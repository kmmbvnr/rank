import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';
import { maskedArray, ownedArray, typedArray } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

function execute(source: string, options: InterpreterOptions = {}, input?: () => RankArray) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    try {
        if (input) runtime.variables.set('A', input());
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { error, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]),
            realSigns: [...runtime.variables].filter(([, value]) => typeof value === 'number').map(([name, value]) => [name, Object.is(value, -0)]) } };
    } finally { runtime.dispose(); }
}

function compare(source: string, input?: () => RankArray) {
    const result = execute(source, {}, input);
    expect(result.state).toEqual(execute(source, { compilation: false }, input).state);
    expect(result.state).toEqual(execute(source, { numberLoopCompilation: false }, input).state);
    return result;
}

// The tuple keeps the outer loop interpreted, so one compiled nested region
// is entered repeatedly, as with a deferred candidate input in Euler 154.
function repeated(between = '', body = 'S += A J') {
    return `use sequences
A = array 1 2 3
S = 0
for Outer in 0 to 3
 for I in 0 to 2
  for J in 0 to I
   ${body}
  end
 end
 ${between}
 Scratch = tuple Outer
end`;
}

describe('revision-guarded Number loop read buffers', () => {
    it.each(['boxed', 'packed'] as const)('borrows %s real matrices with nonfinite and signed-zero cells', kind => {
        const values = [-0, 1.5, Infinity, -Infinity, NaN, 2.5];
        const { diagnostics, state } = compare(`Z = A 0 0
S = 0.0
for I in 0 to 1
 for J in 0 to 2
  S += A I J
 end
end`, () => kind === 'boxed' ? ownedArray([...values], [2, 3], true) : typedArray(Float64Array.from(values), [2, 3]));
        expect(state.error).toBeUndefined();
        expect(state.realSigns).toContainEqual(['Z', true]);
        expect(diagnostics.numberLoopBorrowedRealCells).toBe(6);
        expect(diagnostics.numberLoopReadBufferCells).toBe(0);
    });

    it('keeps masked real holes out of the borrowed path', () => {
        const { diagnostics, state } = compare(`S = 0.0
for I in 0 to 1
 for J in 0 to 2
  S += A I J
 end
end`, () => maskedArray(Float64Array.from([1.5, 2.5, 0, 4.5, 5.5, 6.5]), Uint32Array.of(0b111011), [2, 3]));
        expect(state.variables).toContainEqual(['S', '.NA']);
        expect(diagnostics.numberLoopBorrowedRealBuffers).toBe(0);
    });

    it('keeps host cell getters outside borrowed storage', () => {
        const { diagnostics } = compare(`S = 0.0
for I in 0 to 1
 for J in 0 to 2
  S += A J
 end
end`, () => ({ kind: 'array', shape: [3], get items() { return [1.5, 2.5, 3.5]; } }));
        expect(diagnostics.numberLoopBorrowedRealBuffers).toBe(0);
    });

    it('retains observable demand-budget boundaries', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('A = array 1.5 2.5 3.5\nS = 0.0');
            expect(() => withDemandBudget(70, () => diagnostics.run(() => runtime.execute(`for I in 0 to 100
 for J in 0 to 2
  S += A J
 end
end`)))).toThrow(DemandBudgetExhausted);
            expect(diagnostics.numberLoopBorrowedRealBuffers).toBe(0);
        } finally { runtime.dispose(); }
    });
    it.each(['', 'A 0 += 10', 'Alias = A\nA 0 += 10'])('borrows fresh real storage at each entry: %s', between => {
        const source = repeated(between).replace('array 1 2 3', 'array 1.5 2.5 3.5').replace('S = 0', 'S = 0.0');
        const { diagnostics } = compare(source);
        expect(diagnostics.numberLoops).toBe(4);
        expect(diagnostics.numberLoopBorrowedRealBuffers).toBe(4);
        expect(diagnostics.numberLoopBorrowedRealCells).toBe(12);
        expect(diagnostics.numberLoopReadBufferCells).toBe(0);
    });

    it('keeps borrowed real aliases separate from private writes and overflow replay', () => {
        const { diagnostics, state } = compare(`A = array 1.5 2.5 3.5
B = A
S = 0.0
Count = 9007199254740990
for I in 0 to 2
 for J in 0 to I
  S += A J
  B J += 0.25
  Count += 2
 end
end`);
        expect(state.variables).toContainEqual(['A', '1.5 2.5 3.5']);
        expect(state.variables).toContainEqual(['B', '2.25 3 3.75']);
        expect(diagnostics.numberLoopBorrowedRealBuffers).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it('publishes earlier stores before a borrowed real bounds failure', () => {
        const { diagnostics, state } = compare(`A = array 1.5 2.5 3.5
B = array 0.0 0.0 0.0
S = 0.0
for I in 0 to 1
 for J in 0 to 3
  B 0 = A 0
  S += A J
 end
end`);
        expect(state.error).toContain('out of bounds');
        expect(state.variables).toContainEqual(['B', '1.5 0 0']);
        expect(diagnostics.numberLoopBorrowedRealBuffers).toBeGreaterThan(0);
    });
    it('prepares an unchanged nested-loop input once', () => {
        const { diagnostics, state } = compare(repeated());
        expect(state.variables).toContainEqual(['S', '40']);
        expect(diagnostics.numberLoops).toBe(4);
        expect(diagnostics.numberLoopReadBuffers).toBe(1);
        expect(diagnostics.numberLoopReadBufferCells).toBe(3);
        expect(diagnostics.numberLoopReadBufferHits).toBe(3);
    });

    it.each([
        'A 0 += 10',
        'A = (A + 1) array',
        'Alias = A\nA 0 += 10',
    ])('refreshes snapshots after a store or rebinding: %s', between => {
        const { diagnostics } = compare(repeated(between));
        // Rebound tensor views provide direct reads after the first snapshot.
        expect(diagnostics.numberLoopReadBuffers).toBe(between === 'A = (A + 1) array' ? 1 : 4);
        expect(diagnostics.numberLoopReadBufferHits).toBe(0);
    });

    it('rechecks safe integer conversion after a cached input changes', () => {
        const { diagnostics, state } = compare(repeated('A 1 = 9007199254740992'));
        expect(state.variables).toContainEqual(['S', '54043195528445980']);
        expect(diagnostics.numberLoopReadBuffers).toBe(1);
        expect(diagnostics.fallbacks['number-loop:unsafe-cell']).toBeGreaterThan(0);
    });

    it('retains private replay after arithmetic overflow with a cached input', () => {
        const { diagnostics } = compare(repeated('S = 9007199254740990'));
        expect(diagnostics.numberLoopReadBufferHits).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('publishes preceding progress on a bounds error after a cache hit', () => {
        const { diagnostics, state } = compare(repeated('', 'S += A (J + Outer)'));
        expect(state.error).toContain('out of bounds');
        expect(diagnostics.numberLoopReadBufferHits).toBe(1);
    });

    it('keeps an aliased read snapshot separate from private destination writes', () => {
        const { state, diagnostics } = compare(`A = array 1 2 3
B = A
S = 0
for Outer in 0 to 3
 for I in 0 to 2
  for J in 0 to I
   S += A J
   B J += 1
  end
 end
 Scratch = tuple Outer
end`);
        expect(state.variables).toContainEqual(['A', '1 2 3']);
        expect(state.variables).toContainEqual(['B', '13 10 7']);
        expect(diagnostics.numberLoopReadBufferHits).toBe(3);
    });

    it.each([
        repeated('', 'S += A J').replace('array 1 2 3', 'array 1.5 2.5 3.5').replace('S = 0', 'S = 0.0'),
        repeated('', 'if A J\n S += 1\nend').replace('array 1 2 3', 'array true false true'),
        repeated('A 0 0 += 1', 'S += A 0 J').replace('A = array 1 2 3', 'A = (array 1 2 3) reshape 1 3'),
    ])('retains real, boolean and matrix cell contracts: %s', source => {
        expect(compare(source).diagnostics.numberLoops).toBe(4);
    });
});
