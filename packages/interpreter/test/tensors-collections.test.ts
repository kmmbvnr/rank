import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('Rank tensors and collections', () => {
    it('reports excess indices on a scalar cell as a dimension mismatch', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('A = array 2 2 2 2 shape 2 2');
            expect(() => runtime.execute('A 0 0 0 0 0')).toThrowError('5 selectors exceed array rank 2');
            expect(() => runtime.execute('A 0 0 0'))
                .toThrowError(expect.objectContaining({ rankKind: 'DimensionMismatch' }));
            expect(runtime.execute('A 0 0')).toBe(2n);
        } finally { runtime.dispose(); }
    });

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

    it('continues integer addressing into nested values', () => {
        expect(run([
            'Rows = array "abc" "xyz"',
            'Rows 1 2',
        ].join('\n'))).toBe('z');
        expect(run([
            'T = array shape 2 1',
            '  "ab" "cd"',
            'end',
            'T 1 0 1',
        ].join('\n'))).toBe('d');
    });

    it('reports complete shapes and individual axis lengths', () => {
        expect(run([
            'use sequences',
            'M = array shape 0 3 fill 0',
            'Dims = M shape',
            'Axes = Dims len',
            'Rows = M len',
            'Columns = M len axis 1',
            'Axes * 1000 + Dims 0 * 100 + Dims 1 * 10 + Rows + Columns',
        ].join('\n'))).toBe('2033');
        expect(run('use sequences\n"A😀Б" shape')).toBe('3');
        expect(() => run('use sequences\n(array 1 2) len axis 2'))
            .toThrowError('array has no axis 2');
    });

    it('transposes all axes or uses an explicit axis permutation', () => {
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'T = M transpose',
            'tuple (T shape) T',
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
        expect(run([
            'use sequences',
            'M = (array 1 2 3 4) reshape 2 2',
            'T = M transpose',
            'T 0 0 = 9',
            'tuple T M',
        ].join('\n'))).toBe('9 3 2 4 1 2 3 4');
        expect(() => run([
            'use sequences',
            'T = array shape 2 3 4 fill 0',
            'T transpose axis 2 0',
        ].join('\n'))).toThrowError('transpose expects 3 axes, got 2');
        expect(() => run([
            'use sequences',
            'T = array shape 2 3 4 fill 0',
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
            'tuple (Means shape) Means (Sums shape) Sums',
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
            'T = array shape 2 3 fill 0',
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
            'tuple Lows Highs',
        ].join('\n'))).toBe('-1 2 8 7 4');
        expect(() => run([
            'use numbers',
            'Empty = array shape 2 0 fill 0',
            'Empty min axis 1',
        ].join('\n'))).toThrowError('min requires at least one value');
    });

    it('reduces boolean tensor axes with all, any and count', () => {
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  true true false',
            '  true false false',
            'end',
            'M all axis 0',
        ].join('\n'))).toBe('true false false');
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  true true false',
            '  false false false',
            'end',
            'M any axis 1',
        ].join('\n'))).toBe('true false');
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  true true false',
            '  true false false',
            'end',
            'Rows = M count axis 1',
            'Columns = M count axis 0',
            'tuple Rows Columns',
        ].join('\n'))).toBe('2 1 2 1 0');
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
            'M = array shape 2 3 fill 2',
            'Mask = M greater array 1 2 3',
            'Mask and array true false true',
        ].join('\n'))).toBe('true false false true false false');
        expect(() => run([
            'A = array shape 2 3 fill 0',
            'B = array shape 2 2 fill 0',
            'A + B',
        ].join('\n'))).toThrowError('shape mismatch: 2,3 and 2,2');
        const empty = new Interpreter().execute([
            'A = array shape 0 3 fill 0',
            'B = array shape 1 3 fill 1',
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
            'M = array shape 2 3 fill -1',
            'M 1 0 = 7',
            'M',
        ].join('\n'))).toBe('-1 -1 -1 7 -1 -1');
        expect(run([
            'A = array shape 2 fill 0',
            'Other = A',
            'A 1 = 9',
            'Other 1',
        ].join('\n'))).toBe('0');
        expect(run([
            'A = array shape 2 fill 0',
            'Other = A',
            'A 1 = 9',
            'A 1',
        ].join('\n'))).toBe('9');
        expect(run('Empty = array shape 0 3 fill 5\nEmpty')).toBe('');
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
            'tuple (Column shape) Column (M # 1 sum)',
        ].join('\n'))).toBe('2 2 5 7');
        expect(run([
            'use sequences',
            'T = array shape 2 3 4',
            '  0 1 2 3 4 5 6 7 8 9 10 11',
            '  12 13 14 15 16 17 18 19 20 21 22 23',
            'end',
            'Last = T # # 2',
            'Middle = T # 1',
            'tuple (Last shape) Last (Middle shape) Middle',
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
            'tuple (Block shape) Block',
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
        expect(run([
            'M = array shape 2 2 fill 0',
            'M # # = 7',
            'M',
        ].join('\n'))).toBe('7 7 7 7');
        expect(() => run([
            'M = array shape 2 3 fill 0',
            'M # 1 = array 7 8 9',
        ].join('\n'))).toThrowError('assignment shape mismatch: 2 and 3');
    });

    it('updates tensor selections with compound assignment', () => {
        expect(run([
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'M # 1 *= -1',
            'M 0 += array 10 20 30',
            'M',
        ].join('\n'))).toBe('11 18 33 4 -5 6');
        expect(run([
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'M # 1 += M # 0',
            'M',
        ].join('\n'))).toBe('1 3 3 7');
        expect(() => run([
            'M = array shape 2 3 fill 1',
            'M # 1 += array 1 2 3',
        ].join('\n'))).toThrowError('assignment shape mismatch: 2 and 3');
    });

    it('rejects invalid whole-axis addresses', () => {
        expect(() => run('M = array shape 2 3 fill 0\nM # # #'))
            .toThrowError('array expects at most 2 selectors');
        expect(() => run('M = array shape 2 3 fill 0\nM # 3'))
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
            .toThrowError('cannot materialize an infinite sequence');
        expect(() => run('A = array 1 2\nA copy'))
            .toThrowError('unknown name: copy');
    });

    it('checks addressed array assignment targets and indices', () => {
        expect(() => run('A = 1\nA 0 = 2'))
            .toThrowError('array assignment expects an array target');
        expect(run('A = array shape 2 2 fill 0\nA 0 = 2\nA')).toBe('2 2 0 0');
        expect(() => run('A = array shape 2 fill 0\nA 1.5 = 2'))
            .toThrowError('array index must be an integer on axis 0');
        expect(() => run('A = array shape 2 fill 0\nA -1 = 2'))
            .toThrowError('array index must be nonnegative on axis 0');
        expect(() => run('A = array shape 2 fill 0\nA 2 = 2'))
            .toThrowError('array index out of bounds on axis 0: 2');
        expect(() => run('A = array shape 2 fill 0\nA 2 = Unknown'))
            .toThrowError('array index out of bounds on axis 0: 2');
        expect(run([

            'A = (1 to 2) (1 to 2) outer +',
            'A 0 0 = 9',
            'A',
        ].join('\n'))).toBe('9 3 3 4');
    });

    it('iterates leading-axis cells and selects columns with addressing', () => {
        const matrix = 'M = array shape 2 3\n 1 2 3\n 4 5 6\nend\n';
        expect(run(matrix + 'Total = 0\nfor Row i in M\n Total += Row 0 * 10 + Row 2\nend\nTotal')).toBe('59');
        expect(run(matrix + 'Total = 0\nfor j in 0 till (M len axis 1)\n Column = M # j\n Total += Column 0 * 10 + Column 1\nend\nTotal')).toBe('75');
    });

    it('applies unary functions to trailing or axis-selected tensor cells', () => {
        expect(run([
            'use sequences',
            'fun Cell cell_sum',
            '  return Cell reduce +',
            'end',
            'T = array shape 2 3 2',
            '  1 2 3 4 5 6',
            '  7 8 9 10 11 12',
            'end',
            'Trailing = T cell_sum rank 2',
            'Selected = T cell_sum axis 0 2',
            'Reordered = T cell_sum axis 1',
            'Ok = (Trailing shape equal array 2) and reduce',
            'Ok and= (Trailing equal array 21 57) and reduce',
            'Ok and= (Selected shape equal array 3) and reduce',
            'Ok and= (Selected equal array 18 26 34) and reduce',
            'Ok and= (Reordered shape equal array 2 2) and reduce',
            'Expected = array shape 2 2',
            '  9 12',
            '  27 30',
            'end',
            'Ok and= (Reordered equal Expected) and reduce',
            'Ok',
        ].join('\n'))).toBe('true');
        expect(run([
            'use sequences',
            'fun Row endpoints',
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
            'fun Cell total',
            '  return Cell reduce +',
            'end',
            'T = array shape 2 3 4 fill 0',
            'T total axis 0 rank 2',
        ].join('\n'))).toThrowError(
            'axis count 1 must equal cell rank 2',
        );
        expect(() => run([
            'fun Cell total',
            '  return Cell reduce +',
            'end',
            'T = array shape 2 3 4 fill 0',
            'T total axis 0 0 rank 1',
        ].join('\n'))).toThrowError('axis numbers must be unique');
        expect(() => run([
            'fun Cell total',
            '  return Cell reduce +',
            'end',
            'T = array shape 2 3 4 fill 0',
            'T total axis 0 3 rank 1',
        ].join('\n'))).toThrowError('axis out of bounds: 3');
    });

    it('pushes expression values into a function-local queue', () => {
        expect(run([
            'use algo',
            'fun Value collect',
            '  Queue = new queue',
            '  Queue push Value + 1',
            '  return Queue',
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
            'fun X collect Y',
            '  Seen = new set',
            '  Seen add array 0 0',
            '  Seen add array X Y',
            '  Seen add array X Y',
            '  return Seen len',
            'end',
            '2 collect 3',
        ].join('\n'))).toBe('2');
        expect(run([
            'use algo',
            'fun Value contains',
            '  Seen = new set',
            '  Seen add "Rank"',
            '  return Value in Seen',
            'end',
            '"Rank" contains',
        ].join('\n'))).toBe('true');
        expect(run([
            'use algo',
            'use sequences',
            'fun Value one',
            '  Seen = new set',
            '  Seen add Value',
            '  return Seen len',
            'end',
            'A = 1 one',
            'B = 2 one',
            'A * 10 + B',
        ].join('\n'))).toBe('11');
    });

    it('counts scalar and tuple values in a function-local counter', () => {
        expect(run([
            'use algo',
            'use sequences',
            'fun Values summarize',
            '  Counts = new counter',
            '  for Value in Values',
            '    Counts add Value',
            '  end',
            '  return array (Counts "A") (Counts "Z") (Counts len)',
            'end',
            'Values = array "A" "A" "B"',
            'Values summarize',
        ].join('\n'))).toBe('2 0 2');
        expect(run([
            'use algo',
            'fun X composite Y',
            '  Counts = new counter',
            '  Counts add tuple X Y',
            '  Counts add tuple X Y',
            '  return Counts (tuple X Y)',
            'end',
            '2 composite 3',
        ].join('\n'))).toBe('2');
        expect(run('use algo\nCounts = new counter\nCounts type')).toBe('.counter');
        expect(() => run('Counts = new counter')).toThrowError('new requires: use algo');
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
            'tuple Count First Last',
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
            'fun Unused collect',
            '  Queue = new queue',
            '  Seen = new set',
            '  Seen add "B"',
            '  Seen add "A"',
            '  Seen add "B"',
            '  for Value in Seen',
            '    Queue push Value',
            '  end',
            '  return Queue',
            'end',
            'Answer = 0 collect',
            'First = Answer 0 equal "B"',
            'Second = Answer 1 equal "A"',
            'First and Second',
        ].join('\n'))).toBe('true');
        expect(run([
            'use algo',
            'fun Unused first_route',
            '  Seen = new set',
            '  Seen add "B"',
            '  Seen add "A"',
            '  return Seen permutations 0',
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

            'Values = 1 to 5',
            'Doubled = Values + Values',
            'Doubled unique',
        ].join('\n'))).toBe('2 4 6 8 10');
        expect(() => run([
            'use sequences',
            'Values = array 1 "A"',
            'Values sort',
        ].join('\n'))).toThrowError('arrays require one element type');
    });

    it('generates lazy combinations and preserves tensor cell shape', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 1 2 3 4',
            'Pairs = Values combinations 2',
            'Pairs len',
        ].join('\n'))).toBe('6');
        expect(new Interpreter().execute([
            'use algo',
            'Values = array 1 2 3 4',
            '(Values combinations 2) 5',
        ].join('\n'))).toEqual({ kind: 'array', items: [3n, 4n], shape: [2] });
        expect(new Interpreter().execute([
            'use algo',
            'Matrix = array shape 3 2',
            '  1 2',
            '  3 4',
            '  5 6',
            'end',
            '(Matrix combinations 2) 1',
        ].join('\n'))).toEqual({
            kind: 'array',
            items: [1n, 2n, 5n, 6n],
            shape: [2, 2],
        });
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 7 7',
            'Zero = Values combinations 0 len equal 1',
            'TooMany = Values combinations 3 len equal 0',
            'Positions = Values combinations 1 len equal 2',
            'Zero and TooMany and Positions',
        ].join('\n'))).toBe('true');
        expect(() => run('use algo\nValues = array 1 2\nValues combinations (-1)'))
            .toThrowError('combination count must be nonnegative');
        expect(() => run([
            'use algo',
            'use sequences',
            'fibonacci combinations 2',
        ].join('\n'))).toThrowError('combinations requires a bounded sequence');
    });

    it('generates lazy combinations with repetition', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 1 2 3',
            'Values multicomb 2 len',
        ].join('\n'))).toBe('6');
        expect(new Interpreter().execute([
            'use algo',
            'Values = array 1 2 3',
            '(Values multicomb 2) 3',
        ].join('\n'))).toEqual({ kind: 'array', items: [2n, 2n], shape: [2] });
        expect(new Interpreter().execute([
            'use algo',
            'Matrix = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            '(Matrix multicomb 2) 1',
        ].join('\n'))).toEqual({
            kind: 'array',
            items: [1n, 2n, 3n, 4n],
            shape: [2, 2],
        });
        expect(run([
            'use algo',
            'use sequences',
            'Values = array 7 8',
            'Zero = Values multicomb 0 len equal 1',
            'Large = Values multicomb 100 len equal 101',
            'Zero and Large',
        ].join('\n'))).toBe('true');
        expect(run([
            'use algo',
            'use sequences',
            'Empty = array shape 0 fill 0',
            'Empty multicomb 2 len',
        ].join('\n'))).toBe('0');
        expect(() => run('use algo\nValues = array 1 2\nValues multicomb (-1)'))
            .toThrowError('multicomb count must be nonnegative');
        expect(() => run([
            'use algo',
            'use sequences',
            'fibonacci multicomb 2',
        ].join('\n'))).toThrowError('multicomb requires a bounded sequence');
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
        expect(run('1.0 + 2.5')).toBe('3.5');
        expect(run('9007199254740992 equal 9007199254740993')).toBe('false');
        expect(run('(2 real) equal 2.0')).toBe('true');
        expect(run('use numbers\n-12 abs')).toBe('12');
        expect(run('use numbers\n-2.5 abs')).toBe('2.5');
        expect(run('use numbers\n(array -2 0 3) abs')).toBe('2 0 3');
        expect(run('use numbers\n(-2 to 2) abs')).toBe('2 1 0 1 2');
        expect(run('use numbers\n-infinity abs')).toBe('infinity');
        expect(() => run('use numbers\n"no" abs')).toThrowError('expected numeric input');
        expect(run('use numbers\n9 sqrt')).toBe('3');
        expect(run('use numbers\n2.25 sqrt')).toBe('1.5');
        expect(run('use numbers\n(array 0 4 9) sqrt')).toBe('0 2 3');
        expect(run('use numbers\ninfinity sqrt')).toBe('infinity');
        expect(() => run('use numbers\n-1 sqrt'))
            .toThrowError('sqrt expects a nonnegative value');
        expect(run('use numbers\n(array 0 1 2 15 16 17) isqrt'))
            .toBe('0 1 1 3 4 4');
        expect(run('use numbers\n152415787532388367501905199875019052100 isqrt'))
            .toBe('12345678901234567890');
        expect(() => run('use numbers\n-1 isqrt'))
            .toThrowError('isqrt expects a nonnegative integer');
        expect(() => run('use numbers\n2.25 isqrt'))
            .toThrowError('expected integer input');
        expect(run('use numbers\n3 min 2')).toBe('2');
        expect(run('use numbers\n3 max 2')).toBe('3');
        expect(run('use numbers\n-infinity')).toBe('-infinity');
        expect(run('use cli\narg Rate real = 1.5\nRate')).toBe('1.5');
    });

    it('rounds numeric scalars and arrays to decimal places', () => {
        expect(run('use numbers\n2.5 round 0')).toBe('2');
        expect(run('use numbers\n3.5 round 0')).toBe('4');
        expect(run('use numbers\n-2.5 round 0')).toBe('-2');
        expect(run('use numbers\n1250 round -2')).toBe('1200');
        expect(run('use numbers\n1350 round -2')).toBe('1400');
        expect(run('use numbers\n(1 to 3) round 2')).toBe('1 2 3');
        expect(run([
            'use linalg',
            'use numbers',
            'A = array shape 2 2',
            '  1.23456 0.0',
            '  0.0 2.34567',
            'end',
            'I = array shape 2 2',
            '  1 0',
            '  0 1',
            'end',
            'A matmul I round 3',
        ].join('\n'))).toBe('1.235 0 0 2.346');
        const source = [
            'use numbers',
            'Values = array shape 2 2',
            '  1.23455 2.34564',
            '  3.0 4.0',
            'end',
            'Rounded = Values round 4',
        ];
        expect(run([...source, 'Rounded'].join('\n'))).toBe('1.2346 2.3456 3 4');
        expect(run([...source, 'Rounded 1 0'].join('\n'))).toBe('3');
    });

    it('keeps array rounding lazy and validates its inputs', () => {
        expect(run([
            'use numbers',
            "Values' = (array 1.25 0.0) / (array 1.0 0.0)",
            "Rounded' = Values round 1",
            'Rounded 0',
        ].join('\n'))).toBe('1.2');
        expect(() => run('use numbers\n"Rank" round 2'))
            .toThrowError('round expects numeric input');
        expect(() => run('use numbers\n1.25 round 2.0'))
            .toThrowError('round places must be an integer');
        expect(() => run('1.25 round 2')).toThrowError('unknown name: round; did you forget `use numbers`?');
    });

    it('operates on arbitrary-precision integer bits', () => {
        expect(run('use bits\n123 band 456')).toBe('72');
        expect(run('use bits\n123 bor 456')).toBe('507');
        expect(run('use bits\n123 bxor 456')).toBe('435');
        expect(run('use bits\n123 bnot')).toBe('-124');
        expect(run('use bits\n1 shl 12')).toBe('4096');
        expect(run('use bits\n4096 shr 4')).toBe('256');
        expect(run('use bits\n13 bit 2')).toBe('true');
        expect(run('use bits\n13 popcount')).toBe('3');
        expect(run('use bits\n0 binary')).toBe('0');
        expect(run('use bits\n10 binary')).toBe('1010');
        expect(run('use bits\n3 binary 5')).toBe('00011');
        expect(run('use bits\n(array 0 1) bnot')).toBe('-1 -2');
        expect(() => run('use bits\n1 shl (-1)'))
            .toThrowError('shift count must be nonnegative');
        expect(() => run('use bits\n-1 popcount'))
            .toThrowError('popcount expects a nonnegative integer');
        expect(() => run('use bits\n-1 binary'))
            .toThrowError('binary expects a nonnegative integer');
        expect(() => run('use bits\n1 binary 0'))
            .toThrowError('binary width must be a positive safe integer');
        expect(() => run('use bits\n8 binary 3'))
            .toThrowError('binary value does not fit width 3');
        expect(() => run('1 band 2')).toThrowError('unknown name: band');
    });

});
