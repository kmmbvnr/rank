import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { mapBooleanArrays, mapBroadcastArrays } from '../src/tensor.js';
import type { RankArray } from '../src/value.js';

for (const compilation of [false, true]) describe(`stored boolean masks (compiled=${compilation})`, () => {
    function run(source: string) {
        const runtime = new Interpreter(() => {}, { compilation });
        try { return formatValue(runtime.execute(source)!); } finally { runtime.dispose(); }
    }

    it('combines masks and keeps aliases unchanged across compound assignments', () => {
        expect(run(`A = array true true false false
B = array true false true false
Saved = A
A and= B
array A Saved (Saved or B) (Saved xor B)`)).toBe(
            'true false false false true true false false true true true false false true true false');
    });

    it('retains broadcasting and scalar guards', () => {
        expect(run(`use sequences
A = (array true false) reshape 2 1
B = (array false true true) reshape 1 3
A and B`)).toBe('false true true false false false');
        expect(run('A = array true false\nA and false')).toBe('false false');
        expect(() => run('A = array true false\ntrue and A')).toThrow(/single boolean/);
    });

    it('keeps invalid operand errors deferred until an affected cell is demanded', () => {
        expect(run('A = array 1 2\nB = array true false\nResult = A and B\n7')).toBe('7');
        expect(() => run('A = array 1 2\nB = array true false\nResult = A and B\nResult 0')).toThrow();
        expect(() => run('A = array true false\nB = array true false true\nA and B')).toThrow(/shape mismatch/);
    });
});

describe('boolean mask storage guards', () => {
    it('handles empty tensors and leaves lazy or opaque host cells unread', () => {
        const empty = mapBooleanArrays(ownedArray([], [0, 3]), ownedArray([], [0, 3]), 'and');
        expect(empty?.shape).toEqual([0, 3]);
        expect(empty?.items).toEqual([]);
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt: () => { reads++; return true; } };
        const stored = ownedArray([true, false]);
        expect(mapBooleanArrays(host, stored, 'and')).toBeUndefined();
        const lazy = mapBroadcastArrays(host, stored, (a, b) => a === true && b === true);
        expect(mapBooleanArrays(lazy, stored, 'and')).toBeUndefined();
        expect(reads).toBe(0);
        expect(readArrayItem(lazy, 0)).toBe(true);
        expect(reads).toBe(1);
    });

    it('declines non-boolean stored cells without throwing', () => {
        expect(mapBooleanArrays(ownedArray([1n, 2n]), ownedArray([true, false]), 'and')).toBeUndefined();
    });
});
