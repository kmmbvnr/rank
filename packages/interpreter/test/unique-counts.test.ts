import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { uniqueCounts } from '../src/modules/sequence-distinct.js';
import { isRankTuple } from '../src/value.js';

describe.each([false, true])('unique .counts (compiled=%s)', compiled => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation: compiled });
        const result = runtime.execute(`use sequences\nuse numbers\nuse algo\n${source}`);
        return result === undefined ? undefined : formatValue(result);
    };

    it('returns aligned values and counts in first-appearance order', () => {
        expect(run('A = array 3 1 3 2 1 3\nunpack V C = A unique .counts\nV')).toBe('3 1 2');
        expect(run('A = array 3 1 3 2 1 3\nunpack V C = A unique .counts\nC')).toBe('3 2 1');
        expect(run('unpack V C = 360 factors unique .counts\nV ** C')).toBe('8 9 5');
    });

    it('supports destructuring across lines and subsequent pipeline stages', () => {
        expect(run('unpack V C = (\n  360 factors unique .counts\n)\nC sum')).toBe('6');
        expect(run('(array 1 1 2) unique .counts len')).toBe('2');
    });

    it('returns arrays for Unicode text and for text elements', () => {
        expect(run('unpack V C = "😀a😀b" unique .counts\nV shape')).toBe('3');
        expect(run('unpack V C = "😀a😀b" unique .counts\nC')).toBe('2 1 1');
        expect(run('A = array "cat" "dog" "cat"\nunpack V C = A unique .counts\nV')).toBe('cat dog');
    });

    it.each(['0 till 0', '1 factors', '""', 'new queue', 'new set'])(
        'returns two empty arrays for %s', source => {
            expect(run(`unpack V C = (${source}) unique .counts\narray (V len) (C len)`)).toBe('0 0');
        });

    it('consumes a generator only once', () => {
        expect(run('fun items\n  yield 4\n  yield 4\n  yield 2\nend\n'
            + "Items' = items\nunpack V C = Items unique .counts\nV ** C")).toBe('16 2');
    });

    it('stacks array-valued items and preserves their cell shape', () => {
        const source = 'fun rows\n  yield array 1 2\n  yield array 1 2\n  yield array 3 4\nend\n'
            + "Rows' = rows\nunpack V C = Rows unique .counts\n";
        expect(run(source + 'V shape')).toBe('2 2');
        expect(run(source + 'V')).toBe('1 2 3 4');
        expect(run(source + 'C')).toBe('2 1');
    });

    it('supports structural tuple keys, queues and sets', () => {
        expect(run('A = array (tuple 1 2) (tuple 1 2) (tuple 2 1)\n'
            + 'unpack V C = A unique .counts\nC')).toBe('2 1');
        expect(run('A = new queue (array 2 1 2)\nunpack V C = A unique .counts\nC')).toBe('2 1');
        expect(run('A = new set (array 2 1 2)\nunpack V C = A unique .counts\nC')).toBe('1 1');
    });

    it('handles large integers, booleans, NaN and signed zero', () => {
        expect(run('A = array (2 ** 100) 3 (2 ** 100)\nunpack V C = A unique .counts\nC')).toBe('2 1');
        expect(run('A = array true false true\nunpack V C = A unique .counts\nC')).toBe('2 1');
        expect(run('A = array nan nan 0.0 (-0.0)\nunpack V C = A unique .counts\nC')).toBe('2 2');
    });

    it('retains results independently of later source changes', () => {
        expect(run('A = array 3 1 3\nunpack V C = A unique .counts\nA 0 = 9\nV ** C')).toBe('9 1');
    });

    it('keeps ordinary unique and its consumers unchanged', () => {
        expect(run('"abac" unique')).toBe('abc');
        expect(run('(array 3 1 3) unique len')).toBe('2');
        expect(run('(array 3 1 3) unique sort')).toBe('1 3');
    });

    it('rejects infinite input, missing values and unselected tensor axes', () => {
        expect(() => run('(0 to #) unique .counts')).toThrow(/finite/);
        expect(() => run('(array 1 .NA) unique .counts')).toThrow();
        expect(() => run('A = (1 to 4) reshape 2 2\nA unique .counts')).toThrow(/rank-1/);
    });
});

it('preserves named table columns and compares only the declared cells', () => {
    const row = (name: string, extra: bigint) => ({ kind: 'object' as const,
        entries: new Map<string, string | bigint>([['name', name], ['extra', extra]]) });
    const rows = ownedArray([row('cat', 1n), row('cat', 2n), row('dog', 3n)], [3], false, ['name']);
    const result = uniqueCounts(rows);
    expect(isRankTuple(result)).toBe(true);
    if (!isRankTuple(result)) throw new Error('expected tuple');
    expect(result.items[0]).toHaveProperty('columnNames', ['name']);
    expect(formatValue(result.items[1])).toBe('2 1');
});
