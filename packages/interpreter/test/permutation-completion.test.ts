import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type RankSequence, type RankValue } from '../src/index.js';
import { materializeSequence, stackItems } from '../src/sequence.js';
import { withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';

function setup(source: string) {
    const runtime = new Interpreter();
    runtime.execute(`use algo\nuse sequences`);
    const sequence = runtime.execute(`(${source}) permutations`) as RankSequence;
    return { runtime, sequence };
}

it.each(['array shape 0 fill 0', 'array 3', 'array 3 1 2', 'array 2 1 2',
    'array -1 0 -1', 'array (2 ** 80) 0 (0 - 2 ** 80)'])('copies integer permutations directly in iterator order: %s', source => {
    const { runtime, sequence } = setup(source);
    try {
        const expected = stackItems(sequence.plan.iterate(), undefined, 'sequence');
        const diagnostics = new RuntimeDiagnostics();
        expect(() => withDemandBudget(0, () => diagnostics.run(() => materializeSequence(sequence))))
            .toThrow(DemandBudgetExhausted);
        expect(diagnostics.nativeSequenceCopies).toBe(0);
        const copied = diagnostics.run(() => materializeSequence(sequence));
        expect(copied.shape).toEqual(expected.shape);
        expect(copied.items).toEqual(expected.items);
        expect(diagnostics.nativeSequenceCopies).toBe(1);
        // Neither mutating the completed copy nor partial iteration caches a result.
        copied.items[0] = 123n;
        const iterator = sequence.plan.iterate();
        iterator.next(); iterator.return?.();
        expect(materializeSequence(sequence).items).toEqual(expected.items);
    } finally { runtime.dispose(); }
});

it.each(['"aab"', 'array 1.0 2.0', 'array true false'])('retains ordinary noninteger permutation completion: %s', source => {
    const { runtime, sequence } = setup(source);
    try {
        const expected = stackItems(sequence.plan.iterate(), undefined, 'sequence');
        const diagnostics = new RuntimeDiagnostics();
        const copied = diagnostics.run(() => materializeSequence(sequence));
        expect(copied.shape).toEqual(expected.shape);
        expect(copied.items).toEqual(expected.items);
        expect(diagnostics.nativeSequenceCopies).toBe(0);
    } finally { runtime.dispose(); }
});

it('honors an overridden native iterator without invoking a getter during fast-path admission', () => {
    const { runtime, sequence } = setup('array 1 2');
    try {
        let getters = 0;
        Object.defineProperty(sequence.plan, 'iterate', { get() {
            getters++;
            return function* () { yield 7n; yield 8n; };
        } });
        const diagnostics = new RuntimeDiagnostics();
        expect(diagnostics.run(() => materializeSequence(sequence)).items).toEqual([7n, 8n]);
        expect(getters).toBe(1);
        expect(diagnostics.nativeSequenceCopies).toBe(0);
    } finally { runtime.dispose(); }
});

it('declines changed size evidence and validates the actual ordinary iterator', () => {
    const { runtime, sequence } = setup('array 1 2');
    try {
        Object.assign(sequence.plan.size, { value: 99n });
        const diagnostics = new RuntimeDiagnostics();
        expect(diagnostics.run(() => materializeSequence(sequence)).items).toEqual([1n, 2n, 2n, 1n]);
        expect(diagnostics.nativeSequenceCopies).toBe(0);
    } finally { runtime.dispose(); }
});

describe.each([false, true])('integer permutation demand (compilation=%s)', compilation => {
    it('does not complete an unused large plan and raises only at its copy', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("use algo\nuse sequences\nP' = (1 to 13 array) permutations copy\nReady = 1");
            expect(runtime.variables.get('Ready')).toBe(1n);
            expect(() => runtime.execute('Saved = P')).toThrow(/too large/);
            expect(runtime.variables.has('Saved')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('keeps partial lazy iteration independent of completed copies', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use algo\nuse sequences\nInput = array 3 1 2\nP\' = Input permutations\nFirst = P take 1 array');
            const first = runtime.variables.get('First') as RankValue;
            expect(isRankArray(first) && first.items).toEqual([3n, 1n, 2n]);
            runtime.execute('First 0 0 = 9\nAll = P copy');
            const all = runtime.variables.get('All') as RankValue;
            expect(isRankArray(all) && all.items.slice(0, 3)).toEqual([3n, 1n, 2n]);
        } finally { runtime.dispose(); }
    });
});
