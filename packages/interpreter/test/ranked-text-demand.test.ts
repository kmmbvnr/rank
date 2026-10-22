import { expect, it } from 'vitest';
import { Interpreter, isRankArray, formatValue } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { completed } from '../src/execution.js';
import { standardModules } from '../src/modules/index.js';
import { native } from '../src/modules/shared.js';
import { RankApplication } from '../src/rank-application.js';

it('recomputes ranked text cells across overlapping reads without forcing later cells', () => {
    const calls: string[] = [];
    const fn = native('integer', 1, ([value]) => {
        calls.push(value as string);
        return BigInt(value as string);
    });
    const app = new RankApplication((f, args) => completed(f.call(args)), () => {},
        new Map([[standardModules.core.integer, fn]]), () => undefined);
    const result = app.applyUnaryAtRank('123x', fn, 0);
    if (!('done' in result) || !isRankArray(result.value)) throw new Error('expected immediate array');
    const digits = result.value;
    expect(digits.shape).toEqual([4]);
    expect(calls).toEqual(['1']); // Shape observation may demand a prototype cell.
    for (const index of [0, 1, 1, 2, 0, 2]) {
        expect(readArrayItem(digits, index)).toBe(BigInt(index + 1));
    }
    expect(calls).toEqual(['1', '1', '2', '2', '3', '1', '3']);
    expect(() => readArrayItem(digits, 3)).toThrow();
});

it('preserves lazy per-cell evaluation of user callbacks', () => {
    let calls = 0;
    const fn = native('custom', 1, () => BigInt(++calls));
    const app = new RankApplication((f, args) => completed(f.call(args)), () => {}, new Map(), () => undefined);
    const result = app.applyUnaryAtRank('abc', fn, 0);
    if (!('done' in result) || !isRankArray(result.value)) throw new Error('expected immediate array');
    expect(calls).toBe(0);
    expect(readArrayItem(result.value, 0)).toBe(1n);
    expect(readArrayItem(result.value, 0)).toBe(2n);
    expect(calls).toBe(2);
    expect(readArrayItem(result.value, 1)).toBe(3n);
    expect(calls).toBe(3);
});

it.each([false, true])('preserves Unicode cells and rebinding (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute('Text = "A😀Б"\nChars = Text text rank 0');
        expect(runtime.execute('Chars len')).toBe(3n);
        expect(runtime.execute('Chars 1')).toBe('😀');
        runtime.execute('Text = "xyz"');
        expect(runtime.execute('Chars 1')).toBe('😀');
        expect(runtime.execute('(Text text rank 0) 1')).toBe('y');
    } finally { runtime.dispose(); }
});

for (const compilation of [false, true]) {
    it.each([
        ['sort', ['ab', 'a😀😀', '']],
        ['unique', ['ba', '😀a', '']],
    ] as const)(`keeps variable-width boxed text scalar in ranked %s (compilation=${compilation})`, (operation, expected) => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences\nWords = array "ba" "😀a😀" ""\nPlan' = Words ${operation} rank 0`);
            const saved = runtime.execute('Saved = Plan');
            expect(saved).toMatchObject({ kind: 'array', shape: [3], items: expected });
            expect(runtime.execute('Plan')).toMatchObject({ shape: [3], items: expected });
        } finally { runtime.dispose(); }
    });

    it('composes ranked conversion and text sorting without adding character axes', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            const result = runtime.execute('use sequences\nValues = array 125 1000 8\nKeys = Values text rank 0 sort rank 0');
            expect(result).toMatchObject({ shape: [3], items: ['125', '0001', '8'] });
            expect(formatValue(result!)).toBe('125 0001 8');
        } finally { runtime.dispose(); }
    });

    it('still rejects numeric scalar cells when the ranked sort is demanded', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("use sequences\nBad' = (array 2 1) sort rank 0");
            expect(() => runtime.execute('Saved = Bad')).toThrow(/sort expects text or a rank-1 array/);
        } finally { runtime.dispose(); }
    });
}
