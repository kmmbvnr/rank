import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('sort by', () => {
    it('sorts records lexicographically by fields and preserves ties', () => {
        expect(run([
            'use algo',
            'use sequences',
            'fun event Name Time Delta',
            '  Event = record',
            '    .name = Name',
            '    .time = Time',
            '    .delta = Delta',
            '  end',
            '  return Event',
            'end',
            'Events = queue',
            'Events push "arrive" 4 1 event',
            'Events push "first" 3 1 event',
            'Events push "leave" 4 (-1) event',
            'Events push "second" 3 1 event',
            'Sorted = Events sort by .time .delta',
            'A = Sorted 0 .name equal "first"',
            'B = Sorted 1 .name equal "second"',
            'C = Sorted 2 .name equal "leave"',
            'A and B and C',
        ].join('\n'))).toBe('true');
    });

    it('sorts by a user function evaluated once per item', () => {
        expect(run([
            'use numbers',
            'use sequences',
            'Calls = record',
            '  .count = 0',
            'end',
            'fun magnitude Value',
            '  Calls .count += 1',
            '  return Value abs',
            'end',
            'Values = array -3 1 -1 2',
            'Sorted = Values sort by magnitude',
            'Order = (Sorted equal',
            '  array 1 -1 2 -3) and reduce',
            'Same = (Values equal',
            '  array -3 1 -1 2) and reduce',
            'Order and Same and Calls .count equal 4',
        ].join('\n'))).toBe('true');
    });

    it('materializes finite collection sources', () => {
        expect(run([
            'use ranges',
            'use sequences',
            'fun descending Value',
            '  return 0 - Value',
            'end',
            'Sorted = (1 to 4) sort by descending',
            '(Sorted equal',
            '  array 4 3 2 1) and reduce',
        ].join('\n'))).toBe('true');
    });

    it('reports invalid fields, keys, sources and missing imports', () => {
        expect(() => run([
            'use algo',
            'use sequences',
            'Items = queue',
            'Item = record',
            '  .value = 1',
            'end',
            'Items push Item',
            'Items sort by .missing',
        ].join('\n'))).toThrowError('sort by record is missing field .missing');
        expect(() => run([
            'use sequences',
            'Values = array 1 2',
            'Values sort by .value',
        ].join('\n'))).toThrowError('sort by fields expects records');
        expect(() => run([
            'use sequences',
            'fun pair A B',
            '  return A + B',
            'end',
            'Values = array 1 2',
            'Values sort by pair',
        ].join('\n'))).toThrowError('sort by key must be a unary function');
        expect(() => run([
            'use sequences',
            'fun composite Value',
            '  return array Value',
            'end',
            'Values = array 1 2',
            'Values sort by composite',
        ].join('\n'))).toThrowError('ordered values must be comparable scalars');
        expect(() => run('use sequences\n1 sort by abs'))
            .toThrowError('sort by expects a finite rank-1 collection');
        expect(() => run('Values = array 1\nValues sort by identity'))
            .toThrowError('sort by requires: use sequences');
    });
});
