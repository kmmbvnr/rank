import { describe, expect, it, vi } from 'vitest';
import * as queries from '../src/query-default.js';
import { ownedArray, hasMaskedCells } from '../src/array-storage.js';
import { MISSING } from '../src/value.js';
import { run } from './support.js';

describe('bulk queries under default', () => {
    it('indexes find inputs once and returns missing cells with query shape', () => {
        const result = queries.queryDefault('find', ownedArray([5n, 2n, 5n]), ownedArray([2n, 9n, 5n, 8n], [2, 2]))!;
        expect(result).toMatchObject({ shape: [2, 2] });
        expect(hasMaskedCells(result as ReturnType<typeof ownedArray>)).toBe(true);
        expect((result as ReturnType<typeof ownedArray>).items).toEqual([1n, MISSING, 0n, MISSING]);
    });

    it.each([
        ['use sequences\nK = array 5 2 5\nQ = array 2 9 5\nK find Q default -1', '1 -1 0', 'find'],
        ['I = array 0 -1 2\nC = array 10 20 30\nI C choose default -1', '10 -1 30', 'choose'],
        ['use algo\nS = (array 1 5 9) multiset\nQ = array 0 6 10\nS floor Q default -1', '-1 5 9', 'floor'],
    ])('uses the fused path: %s', (source, expected, operation) => {
        const spy = vi.spyOn(queries, 'queryDefault');
        try {
            expect(run(source)).toBe(expected);
            expect(spy.mock.calls.some(call => call[0] === operation)).toBe(true);
            expect(spy.mock.results.some(result => result.value !== undefined)).toBe(true);
        } finally { spy.mockRestore(); }
    });

    it('leaves fallback lazy and whole-array misses raising', () => {
        expect(run('use sequences\nK = array 1 2\nQ = array 2 1\nK find Q default (1 // 0)')).toBe('1 0');
        expect(() => run('use sequences\nK = array 1 2\nQ = array 9 1\nK find Q')).toThrow('find found no matching value');
        expect(() => run('I = array 0 9\nC = array 10 20\nI C choose')).toThrow('choose index out of bounds');
    });
});
