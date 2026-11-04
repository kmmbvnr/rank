import { describe, expect, it } from 'vitest';
import { RuntimeDiagnostics, recordFallback, currentDiagnostics } from '../src/diagnostics.js';
import { typedArray, noteArrayBinding } from '../src/array-storage.js';
import { Interpreter, formatValue, RankError, withDemandBudget, withInterrupt } from '../src/index.js';

describe('execution cost diagnostics', () => {
    it('separates cost policy from missing proofs', () => {
        const stats = new RuntimeDiagnostics();
        stats.run(() => {
            recordFallback('test:alias', 'aliasing');
            recordFallback('test:copy', 'cost');
            recordFallback('test:legacy');
        });
        expect(stats.fallbackCategories.aliasing).toEqual({ 'test:alias': 1 });
        expect(stats.fallbackCategories.cost).toEqual({ 'test:copy': 1 });
        expect(stats.fallbackCategories.unclassified).toEqual({ 'test:legacy': 1 });
        expect(stats.fallbacks).toEqual({ 'test:alias': 1, 'test:copy': 1, 'test:legacy': 1 });
    });
    it('records failed preparation and restores scopes', () => {
        const stats = new RuntimeDiagnostics();
        const error = new Error('expected');
        expect(() => stats.run(() => stats.measure('prepare', () => { throw error; }))).toThrow(error);
        expect(stats.costs.prepare.calls).toBe(1);
        expect(stats.costs.prepare.milliseconds).toBeGreaterThanOrEqual(0);
        expect(currentDiagnostics()).toBeUndefined();
    });
    it('accounts for private typed copies', () => {
        const source = `for I in 0 till 3
  A I += 1
end
A sum`;
        const runtime = new Interpreter(undefined, { scalarEntryCompilation: false });
        const stats = new RuntimeDiagnostics();
        try {
            runtime.variables.set('A', typedArray(new Int32Array([1, 2, 3]), [3]));
            expect(stats.run(() => runtime.execute(source))).toBe(9n);
            expect(stats.costs['loop.prepare'].calls).toBeGreaterThan(0);
            expect(stats.costs['number-loop.snapshot'].copiedBytes).toBe(12);
            expect(stats.costs['number-loop.dirty'].allocatedBytes).toBe(3);
        } finally { runtime.dispose(); }
    });
});


function observe(source: string, compilation: boolean, enabled: boolean,
    scope: (run: () => void) => void = run => run()) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const stats = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        runtime.execute('use algo\nA = array 0 0 0\nAlias = A\nTotal = 0\nDone = 0');
        const run = () => { runtime.execute(source); };
        try { scope(() => { if (enabled) stats.run(run); else run(); }); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { stats, state: { error, values: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}

const progress = `try
 for I in 0 till 100000
  A (I mod 3) += 1
  Total += I
 end
finally
 Done = 1
end`;

describe.each([false, true])('diagnostic transparency, compilation=%s', compilation => {
    it.each([
        'for I in 0 till 10\n Total += I\nend',
        'for I in 0 till 3\n A I = I\n Total += 1 // (2 - I)\nend',
        'for I in 0 till 3\n A I = I\n Total += 4503599627370495\nend',
        'for I in 0 till 3\n A I = I\n Total += A 8\nend',
    ])('preserves results, errors and partial state: %s', source => {
        expect(observe(source, compilation, true).state).toEqual(observe(source, compilation, false).state);
    });
    it('preserves the first failing operand', () => {
        const source = 'Total = (1 // 0) + A 8';
        const measured = observe(source, compilation, true);
        expect(measured.state).toEqual(observe(source, compilation, false).state);
        expect(measured.state.error).toContain('division by zero');
    });
    it.each([1, 7, 30, 100])('preserves a %s-unit demand budget', budget => {
        const scope = (run: () => void) => withDemandBudget(budget, run);
        const measured = observe(progress, compilation, true, scope);
        expect(measured.state).toEqual(observe(progress, compilation, false, scope).state);
        expect(measured.state.error).toContain('demand budget exhausted');
    });
    it('preserves cancellation publication', () => {
        const scope = (run: () => void) => withInterrupt(new Int32Array([1]), run);
        const measured = observe(progress, compilation, true, scope);
        expect(measured.state).toEqual(observe(progress, compilation, false, scope).state);
        expect(measured.state.error).toContain('Interrupted');
        expect(measured.state.values).toContainEqual(['Done', '1']);
    });
    it('measures shared preparation in either engine', () => {
        const { stats } = observe('Total = 1', compilation, true);
        expect(stats.costs['program.parse'].calls).toBe(1);
        expect(stats.costs['program.execute'].calls).toBe(1);
        expect(stats.costs['input.prepare'].calls).toBe(1);
    });
});

it('records discarded speculative execution separately from preparation failures', () => {
    const result = observe('for I in 0 till 3\n A I = I\n Total += 4503599627370495\nend', true, true);
    expect(result.state.error).toBeUndefined();
    expect(result.stats.costs['number-loop.replay'].discardedAttempts).toBeGreaterThan(0);
    expect(result.stats.costs['number-loop.replay'].discardedMilliseconds).toBeGreaterThanOrEqual(0);
    expect(result.stats.fallbackCategories.representation['number-loop:overflow']).toBeGreaterThan(0);
});

it.each([false, true])('counts shared COW bytes with compilation=%s', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    const stats = new RuntimeDiagnostics();
    try {
        const input = typedArray(new Int32Array([1, 2, 3]), [3]);
        noteArrayBinding(input);
        runtime.variables.set('A', input);
        stats.run(() => runtime.execute('B = A\nB 0 = 7'));
        expect(stats.costs['array.cow'].copiedBytes).toBe(12);
        expect(stats.costs['array.cow'].allocatedBytes).toBe(12);
        expect(runtime.execute('A 0')).toBe(1n);
        expect(runtime.execute('B 0')).toBe(7n);
    } finally { runtime.dispose(); }
});
