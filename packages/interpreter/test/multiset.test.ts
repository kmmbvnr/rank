import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('ordered multiset', () => {
    it('creates an empty named multiset and infers its value type on add', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Bag = new multiset',
            'Before = Bag len',
            'Bag add 5',
            'Bag add 3',
            'array Before (Bag len) (Bag floor 4)',
        ].join('\n'))).toBe('0 2 3');
    });

    it('preserves duplicates and reports its total length', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Bag = (array 5 3 5 8) multiset',
            'Bag len',
        ].join('\n'))).toBe('4');
    });

    it('finds floor and ceiling values and supports pad', () => {
        expect(run([
            'use algo',
            'Bag = (array 5 3 5 8) multiset',
            'Found = Bag floor 6',
            'Found',
        ].join('\n'))).toBe('5');
        expect(run([
            'use algo',
            'Bag = (array 5 3 5 8) multiset',
            'Found = Bag ceiling 6',
            'Found',
        ].join('\n'))).toBe('8');
        expect(run([
            'use algo',
            'Bag = (array 5 3 5 8) multiset',
            'Found = Bag floor 2 pad -1',
            'Found',
        ].join('\n'))).toBe('-1');
    });

    it('adds and removes one occurrence at a time', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Bag = (array 5 3 5) multiset',
            'Bag remove 5',
            'StillThere = 5 in Bag',
            'Bag remove 5',
            'Gone = 5 in Bag',
            'Bag add 4',
            'array StillThere Gone (Bag len)',
        ].join('\n'))).toBe('true false 2');
    });

    it('uses the complete right expression for mutation', () => {
        expect(run([
            'use algo',
            'Bag = (array 2 3) multiset',
            'Bag remove 4 - 2',
            '2 in Bag',
        ].join('\n'))).toBe('false');
    });

    it('iterates in sorted order with duplicates', () => {
        expect(run([
            'use algo',
            'fun ordered Values',
            '  Bag = Values multiset',
            '  for Value in Bag',
            '    queue push Value',
            '  end',
            '  return queue',
            'end',
            'Values = array 7 2 7 4',
            'Values ordered',
        ].join('\n'))).toBe('2 4 7 7');
    });

    it('addresses sorted occurrences by zero-based index', () => {
        expect(run([
            'use algo',
            'Bag = (array 7 2 7 4) multiset',
            'array (Bag 0) (Bag 1) (Bag 2) (Bag 3)',
        ].join('\n'))).toBe('2 4 7 7');
        expect(run([
            'use algo',
            'Bag = (array 7 2 7 4) multiset',
            'Bag remove 2',
            'Bag add 5',
            'array (Bag 0) (Bag 1) (Bag 2) (Bag 3)',
        ].join('\n'))).toBe('4 5 7 7');
        expect(run([
            'use algo',
            'Bag = (array 7 2) multiset',
            'Bag 2 pad -1',
        ].join('\n'))).toBe('-1');
        expect(run([
            'use algo',
            'Bag = (array 7 2) multiset',
            'Bag (-1) pad -1',
        ].join('\n'))).toBe('-1');
    });

    it('exposes numeric extrema in logarithmic time', () => {
        expect(run([
            'use algo',
            'use numbers',
            'Bag = (array 7 2 7 4) multiset',
            'array (Bag min) (Bag max)',
        ].join('\n'))).toBe('2 7');
    });

    it('rejects invalid values and absent removals', () => {
        expect(() => run([
            'use algo',
            'Bag = (array 1 2) multiset',
            'Bag add "three"',
        ].join('\n'))).toThrowError('multiset values must have one comparable type');
        expect(() => run([
            'use algo',
            'Bag = (array 1 2) multiset',
            'Bag remove 3',
        ].join('\n'))).toThrowError('multiset does not contain the value');
        expect(() => run([
            'use algo',
            'use sequences',
            'fibonacci multiset',
        ].join('\n'))).toThrowError('multiset requires a finite sequence');
    });
});
