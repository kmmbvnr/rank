import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type RankSequence } from '../src/index.js';
import { applySelectors } from '../src/value-selection.js';
import { ownedArray } from '../src/array-storage.js';
import { materializeSequence } from '../src/sequence.js';

it.each([false, true])('keeps range masks packed when compiled=%s', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('Mask = (0 till 100000) mod 7 equal 0');
        const actual = diagnostics.run(() => runtime.execute('Indices = (0 till 100000) Mask\nIndices sum'));
        let expected = 0n;
        for (let i = 0n; i < 100000n; i += 7n) expected += i;
        expect(actual).toBe(expected);
        expect(diagnostics.typedUnpacks).toBe(0);
        expect(diagnostics.maskMaterializations).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});
it.each(['10 to -10 by -2', '9007199254740993 to 9007199254741013 by 2'])('keeps exact selected values from %s', range => {
    const runtime = new Interpreter(() => {});
    try {
        const actual = runtime.execute(`Mask = (0 till 11) mod 2 equal 0\nValues = (${range}) Mask\nValues`)!;
        const source = runtime.execute(range) as RankSequence;
        const expected = [...source.plan.iterate()].filter((_, i) => i % 2 === 0);
        expect(formatValue(actual)).toBe(expected.join(' '));
    } finally { runtime.dispose(); }
});
it('retains mask snapshots and validates empty or mismatched selections', () => {
    const runtime = new Interpreter(() => {});
    try {
        expect(formatValue(runtime.execute('Mask = array false true true\nPicked = (1 to 3) Mask\nMask 1 = false\nPicked')!)).toBe('2 3');
        expect(runtime.execute('Empty = (0 till 0) (array shape 0 fill false)\nEmpty len')).toBe(0n);
        expect(() => runtime.execute('(1 to 3) (array true false)')).toThrow('does not match sequence size');
    } finally { runtime.dispose(); }
});
it('does not bypass a replaced source iterator', () => {
    const runtime = new Interpreter(() => {});
    try {
        const source = runtime.execute('0 till 3') as RankSequence;
        source.plan.iterate = function* () { yield 10n; yield 20n; yield 30n; };
        const selected = applySelectors([source, ownedArray([false, true, true])]) as RankSequence;
        expect(formatValue(materializeSequence(selected))).toBe('20 30');
    } finally { runtime.dispose(); }
});

it('honors cancellation and demand budgets when a saved selection is materialized', async () => {
    const { withInterrupt, withDemandBudget, InterruptedError, DemandBudgetExhausted } = await import('../src/interrupt.js');
    const runtime = new Interpreter(() => {});
    try {
        const source = runtime.execute('0 till 10000') as RankSequence;
        const mask = runtime.execute('(0 till 10000) mod 2 equal 0') as Parameters<typeof applySelectors>[0][number];
        const selected = applySelectors([source, mask]) as RankSequence;
        expect(() => withDemandBudget(3, () => materializeSequence(selected))).toThrow(DemandBudgetExhausted);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        signal[0] = 1;
        expect(() => withInterrupt(signal, () => materializeSequence(selected))).toThrow(InterruptedError);
    } finally { runtime.dispose(); }
});
