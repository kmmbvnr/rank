import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('argsort', () => {
    it('returns stable zero-based positions for arrays and text', () => {
        expect(run([
            'use sequences',
            'Values = array 2 1 2 1',
            'Order = Values argsort',
            'Sorted = Values Order',
            'Same = (Order equal',
            '  array 1 3 0 2) and reduce',
            'SortedSame = (Sorted equal',
            '  array 1 1 2 2) and reduce',
            'Text = "cab" argsort',
            'TextSame = (Text equal',
            '  array 1 2 0) and reduce',
            'Same and SortedSame and TextSame',
        ].join('\n'))).toBe('true');
    });

    it('orders every trailing vector by default', () => {
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  3 1 2',
            '  0 5 4',
            'end',
            'Order = M argsort',
            'Expected = array shape 2 3',
            '  1 2 0',
            '  0 2 1',
            'end',
            '(Order equal Expected) and reduce',
        ].join('\n'))).toBe('true');
    });

    it('returns same-shape positions along an explicit axis', () => {
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  3 1 2',
            '  0 5 4',
            'end',
            'Order = M argsort axis 0',
            'Expected = array shape 2 3',
            '  1 0 0',
            '  0 1 1',
            'end',
            '(Order equal Expected) and reduce',
        ].join('\n'))).toBe('true');
    });

    it('reports invalid inputs, axes and missing imports', () => {
        expect(() => run('use sequences\n1 argsort'))
            .toThrowError('argsort expects text or a rank-1 array');
        expect(() => run('use sequences\n(array 1) argsort axis 1'))
            .toThrowError('argsort axis out of bounds: 1');
        expect(() => run('Values = array 1\nValues argsort'))
            .toThrowError('unknown name: argsort');
    });
});

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

describe('argsort by', () => {
    it('returns stable positions for lexicographic record fields', () => {
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
            'Order = Events argsort by .time .delta',
            'Expected = array 1 3 2 0',
            '(Order equal Expected) and reduce',
        ].join('\n'))).toBe('true');
    });

    it('evaluates a unary key once per source item', () => {
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
            'Order = Values argsort by magnitude',
            'Expected = array 1 2 3 0',
            'Matches = Order equal Expected',
            'Same = Matches and reduce',
            'Same and Calls .count equal 4',
        ].join('\n'))).toBe('true');
    });
});
