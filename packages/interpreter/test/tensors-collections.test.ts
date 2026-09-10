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

    it('transposes all axes or uses an explicit axis permutation lazily', () => {
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'T = M transpose',
            'array (T shape) T',
        ].join('\n'))).toBe('3 2 1 4 2 5 3 6');
        expect(run([
            'use sequences',
            'T = array shape 2 2 3',
            '  0 1 2 3 4 5',
            '  6 7 8 9 10 11',
            'end',
            'P = T transpose axis 2 0 1',
            'Dims = P shape',
            'Dims 0 * 1000 + Dims 1 * 100 + Dims 2 * 10 + P 2 1 1',
        ].join('\n'))).toBe('3231');
        expect(() => run([
            'use sequences',
            'M = (array 1 2 3 4) (array 2 2) reshape',
            'T = M transpose',
            'T 0 0 = 9',
        ].join('\n'))).toThrowError('cannot assign to a lazy array');
        expect(() => run([
            'use sequences',
            'T = array shape 2 3 4 pad 0',
            'T transpose axis 2 0',
        ].join('\n'))).toThrowError('transpose expects 3 axes, got 2');
        expect(() => run([
            'use sequences',
            'T = array shape 2 3 4 pad 0',
            'T transpose axis 0 0 2',
        ].join('\n'))).toThrowError('transpose axes must be unique');
    });

    it('reduces selected tensor axes', () => {
        expect(run([
            'use numbers',
            'use sequences',
            'use stats',
            'T = array shape 2 2 3',
            '  1 2 3 4 5 6',
            '  7 8 9 10 11 12',
            'end',
            'Means = T mean axis 1',
            'Sums = T sum axis 0 2',
            'array (Means shape) Means (Sums shape) Sums',
        ].join('\n'))).toBe('2 3 2.5 3.5 4.5 8.5 9.5 10.5 2 30 48');
        expect(run([
            'use stats',
            'Value = (array 1 2 6) mean',
            'Value is .real',
        ].join('\n'))).toBe('true');
        expect(() => run([
            'use stats',
            'Empty = array shape 0',
            'end',
            'Empty mean',
        ].join('\n'))).toThrowError('mean requires at least one value');
        expect(() => run([
            'use numbers',
            'T = array shape 2 3 pad 0',
            'T sum axis 1 1',
        ].join('\n'))).toThrowError('sum axes must be unique');
        expect(run([
            'use numbers',
            'M = array shape 3 2',
            '  3 8',
            '  -1 7',
            '  4 2',
            'end',
            'Lows = M min axis 0',
            'Highs = M max axis 1',
            'array Lows Highs',
        ].join('\n'))).toBe('-1 2 8 7 4');
        expect(() => run([
            'use numbers',
            'Empty = array shape 2 0 pad 0',
            'Empty min axis 1',
        ].join('\n'))).toThrowError('min requires at least one value');
    });

    it('broadcasts trailing singleton dimensions for elementwise operations', () => {
        expect(run([
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'M + array 10 20 30',
        ].join('\n'))).toBe('11 22 33 14 25 36');
        expect(run([
            'Column = array shape 2 1',
            '  10',
            '  20',
            'end',
            'Column + array 1 2 3',
        ].join('\n'))).toBe('11 12 13 21 22 23');
        expect(run([
            'M = array shape 2 3 pad 2',
            'Mask = M greater array 1 2 3',
            'Mask and array true false true',
        ].join('\n'))).toBe('true false false true false false');
        expect(() => run([
            'A = array shape 2 3 pad 0',
            'B = array shape 2 2 pad 0',
            'A + B',
        ].join('\n'))).toThrowError('shape mismatch: 2,3 and 2,2');
        const empty = new Interpreter().execute([
            'A = array shape 0 3 pad 0',
            'B = array shape 1 3 pad 1',
            'A + B',
        ].join('\n'));
        expect(empty).toMatchObject({ kind: 'array', shape: [0, 3], items: [] });
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

    it('addresses complete tensor axes with #', () => {
        expect(run([
            'use numbers',
            'use sequences',
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'Column = M # 1',
            'Explicit = M axis 1 1',
            'array (Column shape) Column (M # 1 sum) Explicit',
        ].join('\n'))).toBe('2 2 5 7 2 5');
        expect(run([
            'use sequences',
            'T = array shape 2 3 4',
            '  0 1 2 3 4 5 6 7 8 9 10 11',
            '  12 13 14 15 16 17 18 19 20 21 22 23',
            'end',
            'Last = T # # 2',
            'Middle = T # 1',
            'array (Last shape) Last (Middle shape) Middle',
        ].join('\n'))).toBe('2 3 2 6 10 14 18 22 2 4 4 5 6 7 16 17 18 19');
    });

    it('uses Cartesian products for several tensor selectors', () => {
        expect(run([
            'use sequences',
            'M = array shape 3 4',
            '  0 1 2 3',
            '  4 5 6 7',
            '  8 9 10 11',
            'end',
            'Rows = array 2 0',
            'Columns = array 3 1',
            'Block = M Rows Columns',
            'array (Block shape) Block',
        ].join('\n'))).toBe('2 2 11 9 3 1');
    });

    it('assigns tensor selections from matching arrays or scalar fills', () => {
        expect(run([
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'M # 1 = array 8 9',
            'M 0 = 0',
            'M',
        ].join('\n'))).toBe('0 0 0 4 9 6');
        expect(run([
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'M # 1 = M # 0',
            'M',
        ].join('\n'))).toBe('1 1 3 3');
        expect(() => run([
            'M = array shape 2 3 pad 0',
            'M # 1 = array 7 8 9',
        ].join('\n'))).toThrowError('assignment shape mismatch: 2 and 3');
    });

    it('rejects invalid whole-axis addresses', () => {
        expect(() => run('M = array shape 2 3 pad 0\nM # # #'))
            .toThrowError('array expects at most 2 selectors');
        expect(() => run('M = array shape 2 3 pad 0\nM # 3'))
            .toThrowError('array index out of bounds on axis 1: 3');
        expect(() => run('#')).toThrowError('# is only valid inside tensor addressing');
    });

    it('copies dense and lazy tensors into independent writable arrays', () => {
        expect(run([
            'use sequences',
            'Source = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'Copy = Source copy',
            'Copy 1 0 = 9',
            'Source 1 0',
        ].join('\n'))).toBe('3');
        expect(run([
            'use sequences',
            'Source = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'Copy = Source transpose copy',
            'Copy 0 1 = 9',
            'Source 1 0',
        ].join('\n'))).toBe('3');
        expect(run([
            'use sequences',
            'Source = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'Copy = Source transpose copy',
            'Copy 0 1 = 9',
            'Copy',
        ].join('\n'))).toBe('1 9 2 4');
        expect(() => run('use sequences\n42 copy'))
            .toThrowError('copy expects an array');
        expect(() => run('use sequences\nfibonacci copy'))
            .toThrowError('copy expects an array');
        expect(() => run('A = array 1 2\nA copy'))
            .toThrowError('unknown name: copy');
    });

    it('checks addressed array assignment targets and indices', () => {
        expect(() => run('A = 1\nA 0 = 2'))
            .toThrowError('array assignment expects an array target');
        expect(run('A = array shape 2 2 pad 0\nA 0 = 2\nA')).toBe('2 2 0 0');
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

    it('applies unary functions to trailing or axis-selected tensor cells', () => {
        expect(run([
            'use sequences',
            'fun cell_sum Cell',
            '  return Cell + reduce',
            'end',
            'T = array shape 2 3 2',
            '  1 2 3 4 5 6',
            '  7 8 9 10 11 12',
            'end',
            'Trailing = T cell_sum rank 2',
            'Selected = T cell_sum axis 1 rank 2',
            'Reordered = T cell_sum axis 2 0 rank 1',
            'Ok = (Trailing shape equal array 2) and reduce',
            'Ok and= (Trailing equal array 21 57) and reduce',
            'Ok and= (Selected shape equal array 3) and reduce',
            'Ok and= (Selected equal array 18 26 34) and reduce',
            'Ok and= (Reordered shape equal array 2 2) and reduce',
            'Expected = array shape 2 2',
            '  9 27',
            '  12 30',
            'end',
            'Ok and= (Reordered equal Expected) and reduce',
            'Ok',
        ].join('\n'))).toBe('true');
        expect(run([
            'use sequences',
            'fun endpoints Row',
            '  return array (Row 2) (Row 0)',
            'end',
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'R = M endpoints rank 1',
            'Ok = (R shape equal array 2 2) and reduce',
            'Expected = array shape 2 2',
            '  3 1',
            '  6 4',
            'end',
            'Ok and= (R equal Expected) and reduce',
            'Ok',
        ].join('\n'))).toBe('true');
        expect(() => run([
            'fun total Cell',
            '  return Cell + reduce',
            'end',
            'T = array shape 2 3 4 pad 0',
            'T total axis 0 1 rank 2',
        ].join('\n'))).toThrowError(
            'axis count 2 plus cell rank 2 must equal tensor rank 3',
        );
        expect(() => run([
            'fun total Cell',
            '  return Cell + reduce',
            'end',
            'T = array shape 2 3 4 pad 0',
            'T total axis 0 0 rank 1',
        ].join('\n'))).toThrowError('axis numbers must be unique');
        expect(() => run([
            'fun total Cell',
            '  return Cell + reduce',
            'end',
            'T = array shape 2 3 4 pad 0',
            'T total axis 0 3 rank 1',
        ].join('\n'))).toThrowError('axis out of bounds: 3');
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
        expect(run('use numbers\n9 sqrt')).toBe('3');
        expect(run('use numbers\n2.25 sqrt')).toBe('1.5');
        expect(run('use numbers\n(array 0 4 9) sqrt')).toBe('0 2 3');
        expect(run('use numbers\ninfinity sqrt')).toBe('infinity');
        expect(() => run('use numbers\n-1 sqrt'))
            .toThrowError('sqrt expects a nonnegative value');
        expect(run('use numbers\n3 2 min')).toBe('2');
        expect(run('use numbers\n3 2 max')).toBe('3');
        expect(run('use numbers\n-infinity')).toBe('-infinity');
        expect(run('use numbers\noption Rate real = 1.5\nRate')).toBe('1.5');
    });

    it('rounds numeric scalars and arrays to decimal places', () => {
        expect(run('use numbers\n2.5 round 0')).toBe('2');
        expect(run('use numbers\n3.5 round 0')).toBe('4');
        expect(run('use numbers\n-2.5 round 0')).toBe('-2');
        expect(run('use numbers\n1250 round -2')).toBe('1200');
        expect(run('use numbers\n1350 round -2')).toBe('1400');
        expect(run('use numbers\nuse ranges\n(1 to 3) round 2')).toBe('1 2 3');
        const source = [
            'use numbers',
            'Values = array shape 2 2',
            '  1.23455 2.34564',
            '  3.0 4',
            'end',
            'Rounded = Values round 4',
        ];
        expect(run([...source, 'Rounded'].join('\n'))).toBe('1.2346 2.3456 3 4');
        expect(run([...source, 'Rounded 1 0'].join('\n'))).toBe('3');
    });

    it('keeps array rounding lazy and validates its inputs', () => {
        expect(run([
            'use numbers',
            'Values = array 1.25 "later"',
            'Rounded = Values round 1',
            'Rounded 0',
        ].join('\n'))).toBe('1.2');
        expect(() => run('use numbers\n"Rank" round 2'))
            .toThrowError('round expects numeric input');
        expect(() => run('use numbers\n1.25 round 2.0'))
            .toThrowError('round places must be an integer');
        expect(() => run('1.25 round 2')).toThrowError('round requires: use numbers');
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
