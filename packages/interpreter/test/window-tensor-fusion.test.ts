import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, isNativeFunction, type RankArray } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { demandValue } from '../src/plan.js';
import { prepareNativeScalarView } from '../src/integer-view.js';
import { windowValue } from '../src/sequence.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(expression: string, input: () => RankArray, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.variables.set('A', input());
        return diagnostics.run(() => {
            try {
                const result = runtime.execute('use sequences\nuse stats\n' + expression)!;
                return { value: isRankArray(result) ? { shape: [...result.shape], cells: [...result.items] } : result, diagnostics };
            } catch (error) { return { error: String(error), diagnostics }; }
        });
    } finally { runtime.dispose(); }
}
const input = () => typedArray(Float64Array.from({ length: 48 }, (_, i) => i / 8), [6, 8]);

function compare(expression: string, source = input) {
    const actual = run(expression, source), reference = run(expression, source, false);
    expect({ ...actual, diagnostics: undefined }).toEqual({ ...reference, diagnostics: undefined });
    return actual;
}

describe('native window addressing and ranked folds', () => {
    it.each(['sum', 'mean', 'min', 'max'])('reuses a graph across window %s cells', operation => {
        const actual = compare(`W' = A window 2 3\n((W + 1) * 0.5) ${operation} rank 2`);
        expect(actual).not.toHaveProperty('error');
        expect(actual.diagnostics.compiledTensors).toBeGreaterThan(1);
        expect(actual.diagnostics.tensorMapPreparations).toBeLessThanOrEqual(3);
        expect(actual.diagnostics.cellsComputed).toBe(0);
    });

    it.each([
        '((A window 2 3 stride 2) * 2) sum rank 2',
        '((A window 2 3 padding 1) * 2) sum rank 2',
        '((A window 2 3 padding 1 wrap) * 2) sum rank 2',
        '((A window 3 axis 0) + 1) sum rank 1',
        '((A window 2 3) + 1) sum axis 3 2 rank 2',
    ])('preserves window geometry and traversal: %s', expression => { expect(compare(expression)).not.toHaveProperty('error'); });

    it.each([NaN, Infinity, -Infinity, 2n ** 100n])('retains nonfinite and wide arithmetic: %s', cell => {
        compare('((A window 2) * 2) sum rank 1', () => ownedArray([cell, cell, cell, cell]));
    });

    it.each([
        [[2, 3, 4], [2, 2], [2, 0]],
        [[3, 4], [2, 3], [0, 1]],
    ])('matches native address order for %j windows %j axes %j', (shape, widths, axes) => {
        const source = ownedArray(Array.from({ length: shape.reduce((n, d) => n * d, 1) }, (_, i) => BigInt(i)), shape);
        const window = windowValue(source, ownedArray(widths.map(BigInt)), axes) as RankArray;
        const view = prepareNativeScalarView(window);
        if (!view) throw Error('missing native window view');
        for (let i = 0; i < window.shape.reduce((n, d) => n * d, 1); i++) {
            expect(source.items[view.offset(i)]).toBe(window.itemAt!(i));
        }
    });

    it('invalidates prepared addressing when live source geometry changes', () => {
        const shape = [3, 4];
        const source: RankArray = { kind: 'array', shape, items: Array.from({ length: 12 }, (_, i) => BigInt(i)) };
        const window = windowValue(source, ownedArray([2n, 2n])) as RankArray;
        const before = prepareNativeScalarView(window);
        if (!before) throw Error('missing view');
        shape[0] = 4; shape[1] = 3;
        expect(before.valid()).toBe(false);
        const after = prepareNativeScalarView(window);
        if (!after) throw Error('missing updated view');
        for (let i = 0; i < 24; i++) expect(source.items[after.offset(i)]).toBe(window.itemAt!(i));
    });

    it('preserves empty output geometry', () => {
        compare('((A window 3) * 2) sum rank 1', () => typedArray(new Float64Array([1, 2])));
    });

    it('preserves snapshots and independent saved values', () => {
        compare("W' = A window 2 3\nSaved = ((W + 1) * 2) sum rank 2\nA 0 0 = 99.0\nSaved");
    });

    it('never reads an opaque source while attempting compilation', () => {
        const reads = (compilation: boolean) => {
            const events: number[] = [];
            const result = run('((A window 3) * 2) sum rank 1', () => ({
                kind: 'array', shape: [5], items: [], itemAt(i) {
                    events.push(i); if (i === 3) throw Error('host failure'); return i + .5;
                },
            }), compilation);
            return { error: result.error, events };
        };
        expect(reads(true)).toEqual(reads(false));
    });

    it('does not bypass a replaced native reducer', () => {
        const runtime = new Interpreter();
        try {
            runtime.variables.set('A', input());
            runtime.execute("use sequences\nop = sum\nView' = ((A window 2 3) * 2) op rank 2");
            const result = demandValue(runtime.variables.get('View')!);
            const op = runtime.variables.get('op')!;
            if (!isRankArray(result) || !isNativeFunction(op)) throw Error('missing native result');
            Object.defineProperty(op, 'call', { value: () => 777n });
            expect(result.items).toEqual(Array(30).fill(777n));
        } finally { runtime.dispose(); }
    });

    it('bounds demand while consuming a private window graph', () => {
        const runtime = new Interpreter();
        try {
            runtime.variables.set('A', typedArray(new Float64Array(20000).fill(1)));
            expect(() => withDemandBudget(30, () => (runtime.execute('use sequences\n((A window 32) * 2) sum rank 1') as RankArray).items)).toThrow(/budget exhausted/);
        } finally { runtime.dispose(); }
    });
});
