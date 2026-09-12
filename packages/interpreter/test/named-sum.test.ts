import { describe, expect, it } from 'vitest';
import { Interpreter, type RankValue } from '../src/index.js';

function sum(items: RankValue[]) {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('A', { kind: 'array', shape: [items.length], items });
        return runtime.execute('use numbers\nA sum');
    } finally { runtime.dispose(); }
}

describe('named array sum', () => {
    it.each([
        { items: [], expected: 0n },
        { items: [9007199254740993n, 1n, -9007199254740993n], expected: 1n },
        { items: [9007199254740993n, 1n, 0.0], expected: 9007199254740994 },
        { items: [9007199254740993n, 0.0, 1n], expected: 9007199254740992 },
        { items: [1e16, 1, -1e16], expected: 0 },
        { items: [-0], expected: 0 },
        { items: [1n, Infinity], expected: Infinity },
        { items: [Infinity, -Infinity], expected: NaN },
        { items: [NaN, 1n], expected: NaN },
    ])('retains the integer seed and left-fold promotion for $items', ({ items, expected }) => {
        expect(sum(items)).toBe(expected);
    });

    it.each([[true], [1n, 'bad'], [0.5, 1n, false], [NaN, 'bad']].map(items => ({ items })))('rejects nonnumeric cells in $items', ({ items }) => {
        expect(() => sum(items)).toThrow('expected numeric input');
    });

    it('forces lazy items before reporting a numeric type error', () => {
        const runtime = new Interpreter();
        const reads: string[] = [];
        runtime.variables.set('A', {
            kind: 'array', shape: [2],
            get items(): RankValue[] {
                reads.push('forced');
                throw new Error('producer failed');
            },
            itemAt: () => { reads.push('item'); return 'bad'; },
        });
        try {
            expect(() => runtime.execute('use numbers\nA sum')).toThrow('producer failed');
            expect(reads).toEqual(['forced']);
        } finally { runtime.dispose(); }
    });
});
