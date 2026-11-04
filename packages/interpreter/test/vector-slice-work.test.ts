import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const size = 262144;
const sieve = `for P in V
 A (P to N by P) *= -1
 Square = P * P
 if Square at most N
  A (Square to N by Square) = 0
 end
end`;
function run(source = sieve, numberLoopCompilation = true,
    vector = [2, 3, 262139], scope: (run: () => unknown) => unknown = run => run()) {
    const runtime = new Interpreter(() => {}, { numberLoopCompilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(`use numbers\nuse sequences\nN = ${size}\nA = array shape (N + 1) fill 1\nDone = 0`);
        runtime.variables.set('V', typedArray(Int32Array.from(vector), [vector.length]));
        let error: string | undefined;
        try { diagnostics.run(() => scope(() => runtime.execute(source))); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            cells: [0, 1, 2, 3, 4, 6, 9, 262139, size].map(i => runtime.execute(`A ${i}`)),
            scalars: ['N', 'P', 'Square', 'Done'].map(name => runtime.variables.get(name)) } };
    } finally { runtime.dispose(); }
}
function compare(source = sieve, vector?: number[], scope?: (run: () => unknown) => unknown) {
    const result = run(source, true, vector, scope);
    expect(result.observation).toEqual(run(source, false, vector, scope).observation);
    return result;
}

describe('slice work in a bounded packed-vector prefix', () => {
    it.each([false, true])('admits amortized sieve slices (reverse=%s)', reverse => {
        const result = compare(reverse ? sieve.replace('in V', 'in V reverse') : sieve);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.cells).toEqual([1n, 1n, -1n, -1n, 0n, 1n, 0n, -1n, 0n]);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeUndefined();
    });

    it('counts descending stepped slices by their selected cells', () => {
        const result = compare(sieve.replace(' A (P', ' End = N // P * P\n A (P').replace('(P to N by P)', '(End to P by -P)')
            .replace('  A (Square', '  Last = N // Square * Square\n  A (Square')
            .replace('(Square to N by Square)', '(Last to Square by -Square)'));
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it.each([[], [2], [262139], [262139, 262139], [2, 262139, 262139, 3, 262139]].map(vector => ({ vector })))(
        'does not overcount a short or insufficient sampled prefix $vector', ({ vector }) => {
            const result = compare(sieve, vector);
            if (vector.length) expect(result.diagnostics.numberLoops).toBe(0);
            expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
        });

    it.each([
        sieve.replace(' A (P', ' if P at most 3\n  continue\n end\n A (P'),
        sieve.replace(' A (P', ' if P equal 2\n  break\n end\n A (P'),
        sieve.replace(' A (P', ' End = A 0\n A (P').replace('P to N by P', 'P to End by P'),
        sieve.replace(' Square =', ' N = 0\n Square ='),
    ])('retains the cap for unknown bounds and incomplete passes', source => {
        const result = compare(source);
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });

    it('replays an overflowing compound slice exactly', () => {
        const result = compare(sieve.replace('*= -1', '*= 9007199254740991 + P'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it('runs finally on a selection error without exposing private stores', () => {
        const result = compare(`try\n${sieve.replace(' A (P', ' End = N\n if P equal 3\n  End = N + P\n end\n A (P').replace('P to N by P', 'P to End by P')}\nfinally\n Done = 1\nend`);
        expect(result.observation.error).toBeDefined();
        expect(result.observation.scalars.at(-1)).toBe(1n);
    });

    it('replays a zero step after preceding successful slice stores', () => {
        const result = compare(sieve, [2, 3, 0]);
        expect(result.observation.error).toBeDefined();
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([20, 2000])('preserves boundaries under a %s-unit demand budget', budget => {
        const result = compare(sieve, undefined, run => withDemandBudget(budget, run));
        expect(result.observation.error).toContain('demand budget exhausted');
    });

    it('retains ordinary observation for a custom interrupt reader', () => {
        const signal = { length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {} };
        const result = compare(sieve, undefined, run => withInterrupt(signal, run));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it('publishes cancellation and runs finally', () => {
        const result = run(`try\n${sieve}\nfinally\n Done = 1\nend`, true, undefined,
            run => withInterrupt(new Int32Array([1]), run));
        expect(result.observation.error).toContain('Interrupted');
        expect(result.observation.scalars.at(-1)).toBe(1n);
    });
});
