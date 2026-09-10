import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('Rank tensors and collections', () => {
    it('constructs and addresses shaped arrays in row-major order', () => {
        expect(run([
            'T = array shape 2 2 2',
            '  1 2 3 4',
            '  5 6 7 8',
            'end',
            'T 1 0 1',
        ].join('\n'))).toBe('6');
        expect(() => run([
            'M = array shape 2 3',
            '  1 2 3',
            'end',
        ].join('\n'))).toThrowError('array shape 2 3 expects 6 elements, got 3');
    });

    it('reports complete shapes and individual axis lengths', () => {
        expect(run([
            'use sequences',
            'M = array shape 0 3 pad 0',
            'Dims = M shape',
            'Dims len * 1000 + Dims 0 * 100 + Dims 1 * 10 + M len + M len axis 1',
        ].join('\n'))).toBe('2033');
        expect(run('use sequences\n"A😀Б" shape')).toBe('3');
        expect(() => run('use sequences\n(array 1 2) len axis 2'))
            .toThrowError('array has no axis 2');
    });

    it('preserves tensor shape under unary operations', () => {
        expect(run([
            'M = array shape 2 2',
            '  true false',
            '  false true',
            'end',
            'N = not M',
            'N 1 0',
        ].join('\n'))).toBe('true');
    });

    it('fills and mutates material arrays in row-major order', () => {
        expect(run([
            'M = array shape 2 3 pad -1',
            'M 1 0 = 7',
            'M',
        ].join('\n'))).toBe('-1 -1 -1 7 -1 -1');
        expect(run([
            'A = array shape 2 pad 0',
            'Alias = A',
            'A 1 = 9',
            'Alias 1',
        ].join('\n'))).toBe('9');
        expect(run('Empty = array shape 0 3 pad 5\nEmpty')).toBe('');
    });

    it('checks addressed array assignment targets and indices', () => {
        expect(() => run('A = 1\nA 0 = 2'))
            .toThrowError('array assignment expects an array target');
        expect(() => run('A = array shape 2 2 pad 0\nA 0 = 2'))
            .toThrowError('array assignment expects 2 indices, got 1');
        expect(() => run('A = array shape 2 pad 0\nA 1.5 = 2'))
            .toThrowError('array index must be an integer on axis 0');
        expect(() => run('A = array shape 2 pad 0\nA -1 = 2'))
            .toThrowError('array index must be nonnegative on axis 0');
        expect(() => run('A = array shape 2 pad 0\nA 2 = 2'))
            .toThrowError('array index out of bounds on axis 0: 2');
        expect(() => run('A = array shape 2 pad 0\nA 2 = Unknown'))
            .toThrowError('array index out of bounds on axis 0: 2');
        expect(() => run([
            'use ranges',
            'A = (1 to 2) (1 to 2) + outer',
            'A 0 0 = 9',
        ].join('\n'))).toThrowError('cannot assign to a lazy array');
    });

    it('iterates tensor cells by rank and explicit axes', () => {
        const matrix = [
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
        ];
        expect(run([
            ...matrix,
            'Total = 0',
            'for Row i in M',
            '  Total += Row 0 * 10 + Row 2',
            'end',
            'Total',
        ].join('\n'))).toBe('59');
        expect(run([
            ...matrix,
            'Total = 0',
            'for Column j in M axis 1 rank 1',
            '  Total += Column 0 * 10 + Column 1',
            'end',
            'Total',
        ].join('\n'))).toBe('75');
        expect(run([
            ...matrix,
            'Total = 0',
            'for Value i j in M rank 0',
            '  Total += Value + i * 10 + j * 100',
            'end',
            'Total',
        ].join('\n'))).toBe('651');
        expect(run([
            'T = array shape 2 2 2',
            '  1 2 3 4',
            '  5 6 7 8',
            'end',
            'Total = 0',
            'for Line i j in T axis 0 1 rank 1',
            '  Total += Line 0 * 10 + Line 1',
            'end',
            'Total',
        ].join('\n'))).toBe('180');
        expect(() => run([
            ...matrix,
            'for Cell i in M axis 0 1 rank 1',
            '  Cell',
            'end',
        ].join('\n'))).toThrowError('axis count 2 plus cell rank 1 must equal tensor rank 2');
        expect(() => run([
            ...matrix,
            'for Value i j in M axis 0 0 rank 0',
            '  Value',
            'end',
        ].join('\n'))).toThrowError('axis numbers must be unique');
        expect(() => run([
            ...matrix,
            'for Value i in M rank 0',
            '  Value',
            'end',
        ].join('\n'))).toThrowError('for expects one value name or 3 value/index names, got 2');
    });

    it('pushes expression values into a function-local queue', () => {
        expect(run([
            'use algo',
            'fun collect Value',
            '  queue push Value + 1',
            '  return queue',
            'end',
            'A = 1 collect',
            'B = 2 collect',
            'A 0 * 10 + B 0',
        ].join('\n'))).toBe('23');
    });

    it('adds unique scalar and array values to a function-local set', () => {
        expect(run([
            'use algo',
            'use sequences',
            'fun collect X Y',
            '  set add array 0 0',
            '  set add array X Y',
            '  set add array X Y',
            '  return set len',
            'end',
            '2 3 collect',
        ].join('\n'))).toBe('2');
        expect(run([
            'use algo',
            'fun contains Value',
            '  set add "Rank"',
            '  return Value in set',
            'end',
            '"Rank" contains',
        ].join('\n'))).toBe('true');
        expect(run([
            'use algo',
            'use sequences',
            'fun one Value',
            '  set add Value',
            '  return set len',
            'end',
            'A = 1 one',
            'B = 2 one',
            'A * 10 + B',
        ].join('\n'))).toBe('11');
    });

    it('counts scalar and array values in a function-local counter', () => {
        expect(run([
            'use algo',
            'use sequences',
            'fun summarize Values',
            '  for Value in Values',
            '    counter add Value',
            '  end',
            '  return array (counter "A") (counter "Z") (counter len)',
            'end',
            'Values = array "A" "A" "B"',
            'Values summarize',
        ].join('\n'))).toBe('2 0 2');
        expect(run([
            'use algo',
            'fun composite X Y',
            '  counter add array X Y',
            '  counter add array X Y',
            '  return counter (array X Y)',
            'end',
            '2 3 composite',
        ].join('\n'))).toBe('2');
        expect(run('use algo\ncounter type')).toBe('.counter');
        expect(() => run('counter add "A"')).toThrowError('counter requires: use algo');
    });

    it('iterates sets and generates distinct finite permutations lazily', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 1 2 3',
            'Routes = Values permutations',
            'Routes len',
        ].join('\n'))).toBe('6');
        expect(new Interpreter().execute([
            'use algo',
            'Values = array 1 2 3',
            'Values permutations 0',
        ].join('\n'))).toEqual({
            kind: 'array',
            items: [1n, 2n, 3n],
            shape: [3],
        });
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 1 1',
            'Values permutations len',
        ].join('\n'))).toBe('1');
        expect(run([
            'use algo',
            'use sequences',
            'Values = "aabc" permutations',
            'Count = Values len',
            'First = Values 0',
            'Last = Values 11',
            'array Count First Last',
        ].join('\n'))).toBe('12 aabc cbaa');
        expect(run([
            'use algo',
            'use sequences',
            'Empty = array shape 0',
            'end',
            'Empty permutations len',
        ].join('\n'))).toBe('1');
        expect(() => run([
            'use algo',
            'use sequences',
            'fibonacci permutations',
        ].join('\n'))).toThrowError('permutations requires a bounded sequence');
        expect(run([
            'use algo',
            'fun collect Unused',
            '  set add "B"',
            '  set add "A"',
            '  set add "B"',
            '  for Value in set',
            '    queue push Value',
            '  end',
            '  return queue',
            'end',
            'Answer = 0 collect',
            'First = Answer 0 equal "B"',
            'Second = Answer 1 equal "A"',
            'First and Second',
        ].join('\n'))).toBe('true');
        expect(run([
            'use algo',
            'fun first_route Unused',
            '  set add "B"',
            '  set add "A"',
            '  return set permutations 0',
            'end',
            'Answer = 0 first_route',
            'First = Answer 0 equal "B"',
            'Second = Answer 1 equal "A"',
            'First and Second',
        ].join('\n'))).toBe('true');
    });

    it('sorts and removes duplicates from rank-1 values', () => {
        expect(run('use sequences\n"caab" sort')).toBe('aabc');
        expect(run('use sequences\n"caabca" unique')).toBe('cab');
        expect(run([
            'use sequences',
            'Values = array 3 1 2 1',
            'Values sort unique',
        ].join('\n'))).toBe('1 2 3');
        expect(run([
            'use sequences',
            'use ranges',
            'Values = 1 to 5',
            'Doubled = Values + Values',
            'Doubled unique array',
        ].join('\n'))).toBe('2 4 6 8 10');
        expect(() => run([
            'use sequences',
            'Values = array 1 "A"',
            'Values sort',
        ].join('\n'))).toThrowError('sort array elements must have one comparable type');
    });

    it('generates lazy combinations and preserves tensor cell shape', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 1 2 3 4',
            'Pairs = Values 2 combinations',
            'Pairs len',
        ].join('\n'))).toBe('6');
        expect(new Interpreter().execute([
            'use algo',
            'Values = array 1 2 3 4',
            'Values 2 combinations 5',
        ].join('\n'))).toEqual({ kind: 'array', items: [3n, 4n], shape: [2] });
        expect(new Interpreter().execute([
            'use algo',
            'Matrix = array shape 3 2',
            '  1 2',
            '  3 4',
            '  5 6',
            'end',
            'Matrix 2 combinations 1',
        ].join('\n'))).toEqual({
            kind: 'array',
            items: [1n, 2n, 5n, 6n],
            shape: [2, 2],
        });
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 7 7',
            'Zero = Values 0 combinations len equal 1',
            'TooMany = Values 3 combinations len equal 0',
            'Positions = Values 1 combinations len equal 2',
            'Zero and TooMany and Positions',
        ].join('\n'))).toBe('true');
        expect(() => run('use algo\nValues = array 1 2\nValues (-1) combinations'))
            .toThrowError('combination count must be nonnegative');
        expect(() => run([
            'use algo',
            'use sequences',
            'fibonacci 2 combinations',
        ].join('\n'))).toThrowError('combinations requires a bounded sequence');
    });

    it('factors integers into a lazy sequence and reduces it', () => {
        expect(run('use numbers\n1 factors')).toBe('');
        expect(run('use numbers\n12 factors')).toBe('2 2 3');
        expect(run('use numbers\nFactors = 13195 factors\nFactors max')).toBe('29');
        expect(() => run('use numbers\n0 factors'))
            .toThrowError('factors expects a positive integer');
    });

    it('evaluates real numbers and numeric vocabulary', () => {
        expect(run('1 / 2')).toBe('0.5');
        expect(run('1 + 2.5')).toBe('3.5');
        expect(run('9007199254740992 equal 9007199254740993')).toBe('false');
        expect(run('2 equal 2.0')).toBe('true');
        expect(run('use numbers\n-12 abs')).toBe('12');
        expect(run('use numbers\n-2.5 abs')).toBe('2.5');
        expect(run('use numbers\n(array -2 0 3) abs')).toBe('2 0 3');
        expect(run('use ranges\nuse numbers\n(-2 to 2) abs')).toBe('2 1 0 1 2');
        expect(run('use numbers\n-infinity abs')).toBe('infinity');
        expect(() => run('use numbers\n"no" abs')).toThrowError('expected numeric input');
        expect(run('use numbers\n3 2 min')).toBe('2');
        expect(run('use numbers\n3 2 max')).toBe('3');
        expect(run('use numbers\n-infinity')).toBe('-infinity');
        expect(run('use numbers\noption Rate real = 1.5\nRate')).toBe('1.5');
    });

    it('operates on arbitrary-precision integer bits', () => {
        expect(run('use bits\n123 456 band')).toBe('72');
        expect(run('use bits\n123 456 bor')).toBe('507');
        expect(run('use bits\n123 456 bxor')).toBe('435');
        expect(run('use bits\n123 bnot')).toBe('-124');
        expect(run('use bits\n1 12 shl')).toBe('4096');
        expect(run('use bits\n4096 4 shr')).toBe('256');
        expect(run('use bits\n13 2 bit')).toBe('true');
        expect(run('use bits\n13 popcount')).toBe('3');
        expect(run('use bits\n0 binary')).toBe('0');
        expect(run('use bits\n10 binary')).toBe('1010');
        expect(run('use bits\n3 5 binary')).toBe('00011');
        expect(run('use bits\n(array 0 1) bnot')).toBe('-1 -2');
        expect(() => run('use bits\n1 (-1) shl'))
            .toThrowError('shift count must be nonnegative');
        expect(() => run('use bits\n-1 popcount'))
            .toThrowError('popcount expects a nonnegative integer');
        expect(() => run('use bits\n-1 binary'))
            .toThrowError('binary expects a nonnegative integer');
        expect(() => run('use bits\n1 0 binary'))
            .toThrowError('binary width must be a positive safe integer');
        expect(() => run('use bits\n8 3 binary'))
            .toThrowError('binary value does not fit width 3');
        expect(() => run('1 2 band')).toThrowError('unknown name: band');
    });

});
