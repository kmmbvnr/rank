import { describe, expect, it } from 'vitest';
import { mergeSorted } from '../src/modules/sorted-merge.js';
import { sequence } from '../src/sequence.js';
import { ownedArray } from '../src/array-storage.js';
import { run } from './support.js';

describe('sorted sequence merge', () => {
    it('merges two streams lazily, including empty and unequal inputs', () => {
        expect(run('use sequences\n(array 1 3 5) (array 2 4) merge array')).toBe('1 2 3 4 5');
        expect(run('use sequences\n(array shape 0 fill 0) (array 2 4) merge array')).toBe('2 4');
        expect(run('use sequences\n(array shape 0 fill 0) (array shape 0 fill 0) merge array')).toBe('');
        expect(run('use sequences\n(array shape 0 fill 0) merge array')).toBe('');
        expect(run('use sequences\n(1 to 9 by 2) (2 to 8 by 2) merge take 4 array')).toBe('1 2 3 4');
        expect(run('use sequences\n(1 to 100 by 2) primes merge take 5 array')).toBe('1 2 3 3 5');
        expect(run('use sequences\nA = 1 to 5 by 2\nB = 2 to 6 by 2\nStreams = array A B\nStreams merge array'))
            .toBe('1 2 3 4 5 6');
    });

    it('merges rows of a matrix in either direction', () => {
        expect(run('use sequences\nM = stack (array 1 3 5) (array 2 4 6)\nM merge array'))
            .toBe('1 2 3 4 5 6');
        expect(run('use sequences\nM = stack (array 5 3 1) (array 6 4 2)\nM merge .descending array'))
            .toBe('6 5 4 3 2 1');
    });

    it('preserves duplicate order by input and checks the promised ordering', () => {
        expect(run('use sequences\n(array 1 2 2) (array 2 2 3) merge array')).toBe('1 2 2 2 2 3');
        expect(() => run('use sequences\n(array 1 3 2) (array 4 5) merge array'))
            .toThrow(/merge expects ascending inputs/);
    });

    it('reads only one head per input before the first result', () => {
        expect(run([
            'use sequences',
            'Reads = record',
            '  .count = 0',
            'end',
            'fun stream Start',
            '  for I in 0 to 3',
            '    Reads .count += 1',
            '    yield Start + I * 2',
            '  end',
            'end',
            'A = 1 stream',
            'B = 2 stream',
            'M = A B merge',
            'First = M first',
            'Reads .count',
        ].join('\n'))).toBe('2');
    });

    it('closes source iterators when a consumer stops early', () => {
        const closed = [false, false];
        const streams = [0, 1].map(index => sequence({
            name: `input ${index}`,
            size: { kind: 'exact', value: 2n },
            *iterate() {
                try {
                    yield BigInt(index + 1);
                    yield BigInt(index + 3);
                } finally {
                    closed[index] = true;
                }
            },
        }));
        const output = mergeSorted(streams, false).plan.iterate();
        expect(output.next().value).toBe(1n);
        output.return?.();
        expect(closed).toEqual([true, true]);
    });

    it('opens a finite collection of streams whose count is not known ahead of time', () => {
        const streams = sequence({
            name: 'streams', size: { kind: 'unknown' },
            *iterate() {
                yield ownedArray([1n, 3n]);
                yield ownedArray([2n, 4n]);
            },
        });
        expect([...mergeSorted([streams], false).plan.iterate()]).toEqual([1n, 2n, 3n, 4n]);
    });

    it('orders records by a field and keeps earlier streams first on equal keys', () => {
        expect(run([
            'use sequences',
            'fun event Time Name',
            '  E = record',
            '    .time = Time',
            '    .name = Name',
            '  end',
            '  return E',
            'end',
            'A = array (1 "a" event) (2 "c" event)',
            'B = array (1 "b" event) (3 "d" event)',
            'M = A B merge by .time',
            'M array',
        ].join('\n'))).toBe('{.time = 1, .name = a} {.time = 1, .name = b} '
            + '{.time = 2, .name = c} {.time = 3, .name = d}');
    });

    it('accepts a collection with a field key and a descending direction', () => {
        expect(run([
            'use sequences',
            'fun event Time',
            '  E = record',
            '    .time = Time',
            '  end',
            '  return E',
            'end',
            'A = array (5 event) (3 event)',
            'B = array (4 event) (2 event)',
            'Streams = stack A B',
            'M = Streams merge by .time .descending',
            'M array',
        ].join('\n'))).toBe('{.time = 5} {.time = 4} {.time = 3} {.time = 2}');
    });

    it('evaluates a function key when each item is read', () => {
        expect(run([
            'use sequences',
            'use numbers',
            'fun magnitude X',
            '  return X abs',
            'end',
            'A = array (-1) (-3) (-5)',
            'B = array 2 4 6',
            'M = A B merge by magnitude',
            'M array',
        ].join('\n'))).toBe('-1 2 -3 4 -5 6');
        expect(run([
            'use sequences',
            'Calls = record',
            '  .count = 0',
            'end',
            'fun key X',
            '  Calls .count += 1',
            '  return X',
            'end',
            'M = (array 1 3 5) (array 2 4 6) merge by key',
            'First = M first',
            'Calls .count',
        ].join('\n'))).toBe('2');
    });

    it('keeps graph DSU merge available when both modules are open', () => {
        expect(run('use graph\nuse sequences\nD = new dsu (array 1 2)\nA = D merge 1 2\nB = D 1 2 merge\nA equal B'))
            .toBe('false');
    });
});
