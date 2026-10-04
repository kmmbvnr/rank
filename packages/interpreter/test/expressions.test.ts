import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo, run } from './support.js';

describe('Rank expressions and sequences', () => {
    it('evaluates expressions with precedence', () => {
        expect(run('2 + 3 * 4')).toBe('14');
        expect(run('(2 + 3) * 4')).toBe('20');
        expect(run('-7 / 3')).toBe('-2.3333333333333335');
        expect(run('-7 // 3')).toBe('-3');
        expect(run('7 // -3')).toBe('-3');
        expect(run('1 not equal 2')).toBe('true');
        expect(run('not false')).toBe('true');
        expect(run('true xor false')).toBe('true');
        expect(run('2 at least 2')).toBe('true');
        expect(run('1 at least 2')).toBe('false');
        expect(run('2 at most 2')).toBe('true');
        expect(run('3 at most 2')).toBe('false');
    });

    it('orders comparable scalar values consistently', () => {
        expect(run('"A" less "B"')).toBe('true');
        expect(run('"A" less "AA"')).toBe('true');
        expect(run('"😀" greater "Z"')).toBe('true');
        expect(run('.age at most .time')).toBe('true');
        expect(run('false less true')).toBe('true');
        expect(run('(array "B" "A") less "B"')).toBe('false true');
        expect(() => run('1 less "2"'))
            .toThrowError('ordered values must have one comparable type');
        expect(() => run('record\n  .value = 1\nend less 2'))
            .toThrowError('ordered values must have one comparable type');
    });

    it('continues infix expressions inside parentheses', () => {
        expect(run([
            'Result = (',
            '  2 + 3',
            '  * 4',
            ')',
            'Result',
        ].join('\n'))).toBe('14');
        expect(run([
            'Mask = (',
            '  3 greater 2',
            '  and 4 less 5',
            ')',
            'Mask',
        ].join('\n'))).toBe('true');
    });

    it('raises numbers and collections to powers', () => {
        expect(run('2 ** 10')).toBe('1024');
        expect(run('2 ** 3 ** 2')).toBe('512');
        expect(run('-2 ** 2')).toBe('-4');
        expect(run('(-2) ** 2')).toBe('4');
        expect(run('2 ** -2')).toBe('0.25');
        expect(run('Value = 2\nValue **= 3\nValue')).toBe('8');
        expect(run('(1 to 4) ** 2')).toBe('1 4 9 16');
        expect(run('A = array 2 3\nA A outer **')).toBe('4 8 9 27');
        expect(() => run('0 ** -1'))
            .toThrowError('zero cannot be raised to a negative power');
        expect(() => run('(-2) ** 0.5')).toThrowError('power result is not real');
    });

    it('applies signs before postfix calls and negates completed predicates', () => {
        expect(run([
            'fun negative X',
            '  return X less 0',
            'end',
            '-7 negative',
        ].join('\n'))).toBe('true');
        expect(run([
            'fun positive X',
            '  return X greater 0',
            'end',
            '+7 positive',
        ].join('\n'))).toBe('true');
        expect(run([
            'fun always_false X',
            '  return false',
            'end',
            'not false always_false',
        ].join('\n'))).toBe('true');
    });

    it('defaults missing addressed values without hiding other errors', () => {
        expect(run('(array 10 20) 2 default 99')).toBe('99');
        expect(run('(array 10) 0 default 1 / 0')).toBe('10');
        expect(run('"ab" 2 default "?"')).toBe('?');
        expect(run('(1 till 3) 2 default 99')).toBe('99');
        expect(run([
            'use algo',
            'fun lookup Key',
            '  Index = new index',
            '  return Index Key default -1',
            'end',
            '7 lookup',
        ].join('\n'))).toBe('-1');
        expect(run('(array 10 20) (-1) default 99')).toBe('99');
        expect(() => run('1 / 0 default 99')).toThrowError('division by zero');
    });

    it('finds one or every matching position', () => {
        expect(run('use sequences\n(array 2 3 4 3) 3 find')).toBe('1');
        expect(run('use sequences\n(array 2 3 4 3) 3 findall')).toBe('1 3');
        expect(run('use sequences\n"23456789TJQKA" "2" find')).toBe('0');
        expect(run('use sequences\n"234232" "2" findall')).toBe('0 3 5');
        expect(run('use sequences\n(array 2 3) 9 find default -1')).toBe('-1');
        expect(run('use sequences\n(array 2 3) 9 findall')).toBe('');
    });

    it('defaults sparse reads lazily without swallowing key or fallback errors', () => {
        const source = [
            'use algo',
            'fun lookup Mode',
            '  Index = new index',
            '  Index 1 2 = false',
            '  if Mode equal 0',
            '    return Index 1 2 default 1 / 0',
            '  end',
            '  if Mode equal 1',
            '    return Index 2 3 default 42',
            '  end',
            '  if Mode equal 2',
            '    return Index (1 / 0) 3 default 42',
            '  end',
            '  return Index 2 3 default Index 9 9',
            'end',
        ].join('\n');
        expect(run(source + '\n0 lookup')).toBe('false');
        expect(run(source + '\n1 lookup')).toBe('42');
        expect(() => run(source + '\n2 lookup')).toThrowError('division by zero');
        expect(() => run(source + '\n3 lookup')).toThrowError('missing keyed value');
    });

    it('keeps variables between executions', () => {
        const interpreter = new Interpreter();
        interpreter.execute('Answer = 6 * 7');
        expect(formatValue(interpreter.execute('Answer')!)).toBe('42');
    });

    it('concatenates text with scalar and elementwise addition', () => {
        expect(run('"Rank" + " language"')).toBe('Rank language');
        expect(run('Text = "A"\nText += "😀"\nText')).toBe('A😀');
        expect(run('(array "A" "B") + "!"')).toBe('A! B!');
        expect(() => run('"Rank" + 1'))
            .toThrowError('+ expects two numeric or two text values');
    });

    it('keeps the inferred type of a variable', () => {
        expect(run('Value = 1\nValue = 2')).toBe('2');
        expect(() => run('Value = 1\nValue = 2.0'))
            .toThrowError('Value has type integer and cannot receive real');
        expect(() => run('Value = 1\nValue /= 2'))
            .toThrowError('Value has type integer and cannot receive real');
    });

    it('exposes runtime types and narrows inferred union values with is', () => {
        expect(run('42 type')).toBe('.integer');
        expect(run('"Rank" type')).toBe('.text');
        expect(run('(array 1 2) type')).toBe('.array');
        expect(run('.Age type')).toBe('.symbol');
        expect(run('42 is .integer')).toBe('true');
        expect(run('42 is .real')).toBe('false');
        expect(run('.Age is .symbol')).toBe('true');
        expect(run(`Values = tuple 1 "two" true
Result = ""
for I in 0 till 3
  Result += (Values I) tag
end
Result
fun tag Value
  if Value is .integer
    return "i"
  end
  if Value is .text
    return "t"
  end
  return "b"
end
Result`)).toBe('itb');
        // The loop name ends with the loop, so the same spelling may start over.
        expect(run([
            'Values = array 1 2',
            'for Value in Values',
            '  Value = Value',
            'end',
            'Value = true',
            'Value',
        ].join('\n'))).toBe('true');
        expect(() => run('42 is "integer"'))
            .toThrowError('is expects a type symbol on the right');
        expect(() => run('42 is .number'))
            .toThrowError('unknown type symbol: .number');
    });

    it('loads vocabulary without changing the grammar', () => {
        expect(run('1 to 3')).toBe('1 2 3');
        expect(run('3 mod 2 equal 0')).toBe('false');
        expect(run('1 to 3')).toBe('1 2 3');
        expect(run('use numbers\n(1 to 5) sum')).toBe('15');
    });

    it('broadcasts scalar operations over sequences', () => {
        expect(run('(1 to 3) * 10')).toBe('10 20 30');
        expect(run('1 to 4 greater 2')).toBe('false false true true');
    });

    it('applies binary operations to the outer cells of finite arrays', () => {
        const product = new Interpreter().execute([

            'A = 1 to 2',
            'B = 3 to 5',
            'A B outer *',
        ].join('\n'));
        expect(product).toMatchObject({ kind: 'array', shape: [2, 3] });
        expect(product && typeof product === 'object' && product.kind === 'array'
            ? product.items
            : undefined).toEqual([3n, 4n, 5n, 6n, 8n, 10n]);

        const tensor = new Interpreter().execute([
            'A = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'B = array 10 20',
            'A B outer +',
        ].join('\n'));
        expect(tensor).toMatchObject({ kind: 'array', shape: [2, 2, 2] });
        expect(tensor && typeof tensor === 'object' && tensor.kind === 'array'
            ? tensor.items
            : undefined).toEqual([11n, 21n, 12n, 22n, 13n, 23n, 14n, 24n]);
        expect(run([
            'A = array 1 3',
            'B = array 2 4',
            'A B outer less',
        ].join('\n'))).toBe('true true false true');
    });

    it('applies named binary functions with intrinsic ranks under outer', () => {
        const xor = new Interpreter().execute([
            'use bits',

            'Values = 0 till 3',
            'Operation = bxor',
            'Values Values outer Operation',
        ].join('\n'));
        expect(xor).toMatchObject({ kind: 'array', shape: [3, 3] });
        expect(xor && typeof xor === 'object' && xor.kind === 'array'
            ? xor.items
            : undefined).toEqual([0n, 1n, 2n, 1n, 0n, 3n, 2n, 3n, 0n]);

        expect(run([
            'use numbers',
            'A = array 3 1',
            'B = array 2 4',
            'A B outer min',
        ].join('\n'))).toBe('2 3 1 1');

        expect(run([
            'use bits',
            'A = (array 1 0) // (array 1 0)',
            'B = array 2',
            'Grid = A B outer bxor',
            'Grid 0 0',
        ].join('\n'))).toBe('3');

        const whole = new Interpreter().execute([
            'use numbers',
            'A = array 1 2',
            'B = array 3 4',
            'Result = A B outer whole',
            '',
            'fun whole A B',
            '  Left = A sum',
            '  Right = B sum',
            '  return Left + Right',
            'end',
            '',
            'Result',
        ].join('\n'));
        expect(whole).toMatchObject({ kind: 'array', shape: [] });
        expect(whole && typeof whole === 'object' && whole.kind === 'array'
            ? whole.items
            : undefined).toEqual([10n]);

        expect(() => run([
            'use numbers',
            'A = array 1 2',
            'A A outer abs',
        ].join('\n'))).toThrowError('outer operation abs must accept 2 arguments');
        expect(() => run([
            'A = array 1',
            'B = array 2',
            'Result = A B outer pair',
            '',
            'fun pair A B',
            '  return array 1 2',
            'end',
            '',
            'Result',
        ].join('\n'))).toThrowError('outer operation pair must return a scalar');
    });

    it('maps and filters an outer tensor lazily', () => {
        expect(run([

            'use numbers',
            'fun even_value X',
            '  return X mod 2 equal 0',
            'end',
            'A = 1 to 3',
            'Products = A A outer *',
            'Mask = Products even_value rank 0',
            'Selected = Products Mask',
            'Selected sum',
        ].join('\n'))).toBe('20');
        expect(() => run('use sequences\nfibonacci fibonacci outer *'))
            .toThrowError('outer left operand must be finite');
        expect(() => run([
            'A = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'Mask = array true false true false',
            'A Mask',
        ].join('\n'))).toThrowError('mask shape mismatch: 2,2 and 4');
    });

    it('builds overlapping text and sequence windows', () => {
        expect(run('use sequences\n"A😀БC" 2 window')).toBe('A😀 😀Б БC');
        expect(run([
            'use sequences',
            'Pairs = "xyxy" 2 window',
            'Pairs 0 equal Pairs 2',
        ].join('\n'))).toBe('true');
        expect(run([

            'use sequences',
            'Windows = (1 to 4) 3 window',
            'Windows reduce * rank 1',
        ].join('\n'))).toBe('6 24');
        expect(run('use sequences\n(array 1 2) 3 window')).toBe('');
        expect(() => run('use sequences\n(array 1 2) 0 window'))
            .toThrowError('window sizes must be positive integers');
        expect(() => run('(array 1 2) 2 window'))
            .toThrowError('unknown name: window');
        expect(run([
            'use sequences',
            'Pairs = (primes till 10) 2 window',
            'Pair = Pairs 2',
            'Pair reduce +',
        ].join('\n'))).toBe('12');
    });

    it('builds multidimensional windows over selected axes', () => {
        const source = [
            'use sequences',
            'M = array shape 3 4',
            '  1 2 3 4',
            '  5 6 7 8',
            '  9 10 11 12',
            'end',
        ];
        const windows = new Interpreter().execute([
            ...source,
            'Size = array 2 2',
            'M Size window',
        ].join('\n'));
        expect(windows).toMatchObject({ kind: 'array', shape: [2, 3, 2, 2] });
        expect(windows && typeof windows === 'object' && windows.kind === 'array'
            ? windows.items
            : undefined).toEqual([
            1n, 2n, 5n, 6n,
            2n, 3n, 6n, 7n,
            3n, 4n, 7n, 8n,
            5n, 6n, 9n, 10n,
            6n, 7n, 10n, 11n,
            7n, 8n, 11n, 12n,
        ]);
        expect(run([
            ...source,
            'Size = array 2 2',
            'Windows = M Size window',
            'Windows reduce + rank 2',
        ].join('\n'))).toBe('14 18 22 30 34 38');
        expect(run([
            ...source,
            'Windows = M 3 window axis 1',
            'Windows reduce + rank 1',
        ].join('\n'))).toBe('6 9 18 21 30 33');
        expect(() => run([
            ...source,
            'M (array 2 2) window axis 0',
        ].join('\n'))).toThrowError('window has 2 size value but 1 selected axes');
        expect(() => run([
            ...source,
            'M 2 window',
        ].join('\n'))).toThrowError('window has 1 size value but 2 selected axes');
    });

    it('applies window stride and zero padding', () => {
        expect(run([
            'use sequences',
            'A = array 1 2 3 4 5',
            'A 2 window stride 2',
        ].join('\n'))).toBe('1 2 3 4');
        expect(run([
            'use sequences',
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'S = array 2 2',
            'M S window stride 2 padding 1',
        ].join('\n'))).toBe([
            '0 0 0 1 0 0 2 0',
            '0 3 0 0 4 0 0 0',
        ].join(' '));
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'M 2 window stride 2 padding 1 axis 1',
        ].join('\n'))).toBe('0 1 2 3 0 4 5 6');
        expect(run([
            'use sequences',
            'M = array shape 2 2 fill 1',
            'S = array 2 2',
            'Stride = array 1 2',
            'Pad = array 0 1',
            'W = M S window stride Stride padding Pad',
            'W shape',
        ].join('\n'))).toBe('1 2 2 2');
        expect(() => run([
            'use sequences',
            '(array 1 2) 1 window stride 0',
        ].join('\n'))).toThrowError('window strides must be positive integers');
        expect(() => run([
            'use sequences',
            '(array 1 2) 1 window padding (-1)',
        ].join('\n'))).toThrowError('window padding must be nonnegative integers');
    });

    it('fills window padding with a chosen value', () => {
        expect(run([
            'use sequences',
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'M 2 window padding 1 with 9 axis 1',
        ].join('\n'))).toBe('9 1 1 2 2 9 9 3 3 4 4 9');
        expect(run([
            'use sequences',
            'A = array 1 2 3',
            'A 2 window padding 1 with 7',
        ].join('\n'))).toBe('7 1 1 2 2 3 3 7');
        expect(run([
            'use sequences',
            'use numbers',
            'A = array 1 2 3',
            'B = A 3 window padding 1 with -infinity',
            'B max rank 1',
        ].join('\n'))).toBe('2 3 3');
        expect(() => run([
            'use sequences',
            'A = array 1 2 3',
            'A 2 window padding 1 with (array 1 2)',
        ].join('\n'))).toThrowError('window padding fill must be a single value');
    });

    it('addresses a tensor with a coordinate vector and offsets', () => {
        const source = [
            'use sequences',
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'Cell = array 1 1',
            'Up = array -1 0',
        ];
        const at = (line: string) => run([...source, line].join('\n'));
        expect(at('M unpack Cell')).toBe('4');
        expect(at('M unpack (Cell + Up)')).toBe('2');
        expect(at('Next = Cell + Up\nM unpack Next')).toBe('2');
        expect(at('M unpack Cell + Up')).toBe('3 4');
    });

    it('shifts items along an axis', () => {
        const source = [
            'use sequences',
            'A = array 1 2 3 4',
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
        ];
        const shifted = (line: string) => run([...source, line].join('\n'));
        expect(shifted('A 1 shift')).toBe('0 1 2 3');
        expect(shifted('A (-1) shift')).toBe('2 3 4 0');
        expect(shifted('A 2 shift with 9')).toBe('9 9 1 2');
        expect(shifted('A 9 shift')).toBe('0 0 0 0');
        expect(shifted('M 1 shift axis 1')).toBe('0 1 2 0 4 5');
        expect(shifted('M 1 shift')).toBe('0 0 0 1 2 3');
        expect(shifted('M (-1) shift with 7 axis 0')).toBe('4 5 6 7 7 7');
        expect(() => shifted('M 1 shift axis 2')).toThrowError('shift axis out of bounds: 2');
        expect(() => shifted('A 1 shift with (array 1)')).toThrowError('shift fill must be a single value');
        expect(() => shifted('"ab" 1 shift')).toThrowError('shift expects an array');
    });

    it('reshapes finite values in row-major order', () => {
        const matrix = new Interpreter().execute([
            'use sequences',

            'M = (1 to 6) (array 2 3) reshape',
            'M',
        ].join('\n'));
        expect(matrix).toMatchObject({ kind: 'array', shape: [2, 3] });
        expect(matrix && typeof matrix === 'object' && matrix.kind === 'array'
            ? matrix.items
            : undefined).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
        expect(run([
            'use sequences',
            'M = "A😀БC" (array 2 2) reshape',
            'M 1 0',
        ].join('\n'))).toBe('Б');
        expect(run([
            'use sequences',
            'use algo',
            'fun matrix Unused',
            '  Queue = new queue',
            '  Queue push 1',
            '  Queue push 2',
            '  Queue push 3',
            '  Queue push 4',
            '  return Queue (array 2 2) reshape',
            'end',
            '0 matrix 1 1',
        ].join('\n'))).toBe('4');
        expect(() => run('use sequences\n(array 1 2 3) (array 2 2) reshape'))
            .toThrowError('reshape shape 2 2 expects 4 elements, got 3');
        expect(() => run('use sequences\nfibonacci (array 1) reshape'))
            .toThrowError('reshape requires a finite sequence');
        expect(() => run('use sequences\n(array 1) (array -1) reshape'))
            .toThrowError('reshape dimension must be nonnegative: -1');
        expect(() => run('(array 1) (array 1) reshape'))
            .toThrowError('unknown name: reshape');
    });

    it('evaluates range expressions in array declarations and shapes', () => {
        const matrix = new Interpreter().execute([
            'M = array 1 to 4 shape 2 2',
            'M',
        ].join('\n'));
        expect(matrix).toMatchObject({ kind: 'array', shape: [2, 2], items: [1n, 2n, 3n, 4n] });

        const vector = new Interpreter().execute([
            'V = array 1 to 5',
            'V',
        ].join('\n'));
        expect(vector).toMatchObject({ kind: 'array', shape: [5], items: [1n, 2n, 3n, 4n, 5n] });

        const stepped = new Interpreter().execute([
            'O = array 1 to 9 by 2 shape 5 1',
            'O',
        ].join('\n'));
        expect(stepped).toMatchObject({ kind: 'array', shape: [5, 1], items: [1n, 3n, 5n, 7n, 9n] });

        const exclusive = new Interpreter().execute([
            'G = array 0 till 4 shape 2 2',
            'G',
        ].join('\n'));
        expect(exclusive).toMatchObject({ kind: 'array', shape: [2, 2], items: [0n, 1n, 2n, 3n] });

        expect(run('M = array 1 to 4 shape 2 2\nM 1 0')).toBe('3');

        expect(() => run('array 1 to 5 shape 2 2'))
            .toThrowError('array shape 2 2 expects 4 elements, got 5');
    });

    it('reduces complete values and trailing cells', () => {
        expect(run('(array 2 3 4) reduce *')).toBe('24');
        expect(run('(array 1 2 3) reduce +')).toBe('6');
        expect(run('(array true true false) and reduce')).toBe('false');
        const empty = 'Empty = array shape 0\nend\nEmpty';
        expect(run(`${empty} reduce +`)).toBe('0');
        expect(run(`${empty} reduce *`)).toBe('1');
        expect(() => run(`${empty} reduce -`))
            .toThrowError('reduce - does not define a value for an empty cell');
        expect(() => run('use sequences\nfibonacci reduce +'))
            .toThrowError('reduce + requires a bounded sequence');
    });

    it('names boolean reductions and applies them at rank', () => {
        expect(run('use sequences\n(array true true) all')).toBe('true');
        expect(run('use sequences\n(array false true) any')).toBe('true');
        expect(run('use sequences\n(array true false true) count')).toBe('2');
        expect(run('use sequences\n((1 to 5) greater 2) count')).toBe('3');
        const empty = 'Empty = array shape 0\nend\nEmpty';
        expect(run(`use sequences\n${empty} all`)).toBe('true');
        expect(run(`use sequences\n${empty} any`)).toBe('false');
        expect(run(`use sequences\n${empty} count`)).toBe('0');
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  true true false',
            '  false false false',
            'end',
            'M all rank 1',
        ].join('\n'))).toBe('false false');
        expect(run([
            'use sequences',
            'M = array shape 2 3',
            '  true true false',
            '  false false false',
            'end',
            'M count rank 1',
        ].join('\n'))).toBe('2 0');
        expect(() => run('use sequences\n(array 1 2) all'))
            .toThrowError('all expects boolean values');
        expect(() => run('use sequences\n(array 1 2) count'))
            .toThrowError('count expects boolean values');
        expect(() => run('use sequences\nfibonacci any'))
            .toThrowError('any requires a bounded sequence');
        expect(() => run('use sequences\nfibonacci count'))
            .toThrowError('count requires a bounded sequence');
        expect(() => run('(array true false) all'))
            .toThrowError('unknown name: all');
        expect(() => run('(array true false) count'))
            .toThrowError('unknown name: count');
        expect(run([
            'use sequences',
            'fun not_all Dummy',
            '  yield false',
            '  .Demanded raise',
            'end',
            'fun has_any Dummy',
            '  yield true',
            '  .Demanded raise',
            'end',
            'array (0 not_all all) (0 has_any any)',
        ].join('\n'))).toBe('false true');
    });

    it('returns the true positions of a boolean vector', () => {
        expect(run('use sequences\n(array true false true false) indices')).toBe('0 2');
        expect(run('use sequences\n(array false false) indices')).toBe('');
        const empty = 'Mask = array shape 0\nend\nMask';
        expect(run(`use sequences\n${empty} indices`)).toBe('');
        expect(() => run('use sequences\n(array 1 2) indices'))
            .toThrowError('indices expects boolean values');
        expect(() => run('use sequences\ntrue indices'))
            .toThrowError('indices expects a rank-1 array');
        expect(() => run([
            'use sequences',
            'Mask = array shape 2 2',
            '  true false',
            '  false true',
            'end',
            'Mask indices',
        ].join('\n'))).toThrowError('indices expects a rank-1 array');
        expect(() => run('(array true false) indices'))
            .toThrowError('unknown name: indices');
    });

    it('updates values with compound assignment', () => {
        expect(run('Value = 10\nValue += 5\nValue *= 2\nValue -= 4\nValue //= 2\nValue mod= 4\nValue')).toBe('1');
        expect(run('Mask = true\nMask and= true\nMask xor= true\nMask or= true\nMask')).toBe('true');
    });

    it('runs Euler 1 with word operations and a mask', () => {
        const source = [

            'use numbers',
            'N = 1 till 1000',
            'Mask = N mod 3 equal 0',
            'Mask or= N mod 5 equal 0',
            'N Mask sum',
        ].join('\n');
        expect(run(source)).toBe('233168');
    });

    it('combines masks from repeated built-in sequence references', () => {
        expect(run('use sequences\nuse numbers\nfibonacci (fibonacci mod 5 equal 0 or fibonacci mod 3 equal 0) till 100'))
            .toBe('3 5 21 55');
        expect(run('use sequences\nuse numbers\nprimes (primes mod 5 equal 0 or primes mod 3 equal 0) till 100'))
            .toBe('3 5');
        // Masks of different sequences combine position by position.
        expect(run('use sequences\nuse numbers\n(fibonacci even or primes even) take 4 array'))
            .toBe('true true false false');
        expect(run('use sequences\nuse numbers\nfibonacci (fibonacci even or primes even) take 3 array'))
            .toBe('1 2 8');
        expect(() => run('use sequences\nuse numbers\n(10 to 15) (fibonacci even or primes even) array'))
            .toThrowError('mask is longer than the values it selects from');
    });

    it('consumes sequence masks as booleans and selects values explicitly', () => {
        const setup = 'use sequences\nB = 1 to 3\nMask = B greater 2\n';
        for (const expression of ['Mask', 'array Mask', 'Mask array', 'Mask copy']) {
            expect(run(setup + expression)).toBe('false false true');
        }
        expect(run(setup + 'B Mask')).toBe('3');
        expect(run(setup + '(B Mask) array')).toBe('3');
        expect(run(setup + 'Mask len')).toBe('3');
        expect(run(setup + 'Mask 0')).toBe('false');
        expect(run(setup + 'Mask count')).toBe('1');
        expect(run(setup + 'Mask any')).toBe('true');
        expect(run(setup + 'Mask all')).toBe('false');
        expect(run(setup + '(not Mask) array')).toBe('true true false');
        expect(run(setup + '(Mask or (B equal 1)) array')).toBe('true false true');
        expect(run(setup + 'Mask take 2 array')).toBe('false false');
        expect(run(setup + 'Mask 2 window')).toBe('false false false true');
        expect(run(setup + 'Result = true\nfor Value in Mask\nResult and= Value\nend\nResult'))
            .toBe('false');
        expect(run('use sequences\nB = 1 till 1\nMask = B greater 2\nMask len')).toBe('0');
    });

    it('keeps explicit Fibonacci selection lazy', () => {
        const setup = 'use sequences\nuse numbers\nFib = fibonacci till 100\nMask = Fib even\n';
        expect(run(setup + 'Fib Mask sum')).toBe('44');
        expect(run(setup + 'Mask count')).toBe('3');
        expect(run(setup + '(Fib Mask) 1')).toBe('8');
        expect(run(setup + 'Pairs = (Fib Mask) 2 window\nPairs 1 reduce +')).toBe('42');
        expect(run('use sequences\nuse numbers\nFib = fibonacci\nMask = Fib even\nFib Mask till 100'))
            .toBe('2 8 34');
        // A mask is positional: a finite one bounds the selection from an endless source.
        expect(run('use sequences\nuse numbers\nMask = fibonacci till 100 even\nfibonacci Mask array'))
            .toBe('2 8 34');
        expect(run('use sequences\nuse numbers\nMask = (1 to 5) even\n(100 to 104) Mask array'))
            .toBe('101 103');
        expect(() => run('use sequences\nuse numbers\nMask = (1 to 5) even\n(1 to 2) Mask array'))
            .toThrowError('mask is longer than the values it selects from');
    });

    it('reduces the values a sequence mask selects with numeric operations', () => {
        const setup = 'use sequences\nuse numbers\nuse stats\nFib = fibonacci till 100\n';
        expect(run(setup + 'Fib even sum')).toBe('44');
        expect(run(setup + 'Fib even max')).toBe('34');
        expect(run(setup + 'Fib even min')).toBe('2');
        expect(run(setup + 'Fib even median')).toBe('8');
        expect(run(setup + 'Fib even count')).toBe('3');
        // Only a mask made in the same pipeline stands for its values; a named one is booleans.
        expect(() => run(setup + 'Mask = Fib even\nMask sum'))
            .toThrowError('sum of a named mask: write `Values Mask sum`');
        expect(run(setup + 'Mask = Fib even\nFib Mask sum')).toBe('44');
        // The mask itself still holds booleans.
        expect(run(setup + 'Fib even array')).toBe('false true false false true false false true false false');
        expect(() => run('use sequences\nuse numbers\nfibonacci even sum'))
            .toThrowError('sum requires a bounded sequence');
    });

    it('reduces the cells an array mask selects with numeric operations', () => {
        const setup = 'use numbers\nuse stats\nA = array 1 2 3 4 5\n';
        expect(run(setup + 'A even sum')).toBe('6');
        expect(run(setup + 'A odd max')).toBe('5');
        expect(run(setup + 'A even mean')).toBe('3');
        expect(run(setup + 'Mask = A greater 2\nA Mask sum')).toBe('12');
        expect(run(setup + 'Mask = A greater 1 and (A less 5)\nA Mask sum')).toBe('9');
        expect(run(setup + 'Mask = not (A even)\nA Mask sum')).toBe('9');
        expect(() => run(setup + 'Mask = A greater 2\nMask sum')).toThrowError('sum of a named mask');
        expect(() => run(setup + 'Mask = A greater 2\nMask mean')).toThrowError('mean of a named mask');
        expect(run(setup + 'A even')).toBe('false true false true false');
        expect(run('use numbers\nM = array 1 2 3 4 5 6 shape 2 3\nM even sum')).toBe('12');
        expect(run('use numbers\nM = array 1 2 3 4 5 6 shape 2 3\nM (M even)')).toBe('2 4 6');
        // A mask selects by position from whatever it is applied to.
        expect(run(setup + 'Mask = A even\nA 1 = 10\nA Mask sum')).toBe('14');
        expect(run(setup + 'Mask = A even\nA 1 = 10\nA')).toBe('1 10 3 4 5');
        expect(run(setup + 'Mask = A even\nMask 0 = true\nA Mask sum')).toBe('7');
        expect(run(setup + 'B = array 5 4 3 2 1\nMask = A even and (B even)\nA Mask sum')).toBe('6');
    });

    it('reads a record field before the function that follows it', () => {
        const setup = 'use numbers\nR = record\n  .slots = array 1 5 2\n  .inner = record\n    .order = array 7 8 9\n  end\nend\n';
        expect(run(setup + 'R .slots max')).toBe('5');
        expect(run(setup + 'R .slots 2 max')).toBe('2 5 2');
        expect(run(setup + 'R .slots len')).toBe('3');
        expect(run(setup + 'R .inner .order 1')).toBe('8');
        expect(run(setup + 'Order = R .inner .order\nOrder max')).toBe('9');
        // A label that is not one of the record's fields stays an argument.
        expect(() => run(setup + 'R .missing max')).toThrowError();
    });

    it('does not reduce an unbounded sequence', () => {
        expect(() => run('use sequences\nuse numbers\nfibonacci sum'))
            .toThrowError('sum requires a bounded sequence');
    });

    it('indexes and bounds lazy prime sequences', () => {
        expect(run('use sequences\nprimes 5')).toBe('13');
        expect(run('use sequences\nprimes till 20')).toBe('2 3 5 7 11 13 17 19');
        expect(run('use sequences\nprimes till 19')).toBe('2 3 5 7 11 13 17');
        expect(run('use sequences\n17 in primes')).toBe('true');
        expect(run('use sequences\n17.0 in primes')).toBe('true');
        expect(run('use sequences\n18 in primes')).toBe('false');
        expect(run('use sequences\n23 in (primes till 20)')).toBe('false');
        expect(run('use sequences\n8 in (fibonacci till 20)')).toBe('true');
        expect(run('use sequences\nP = primes from 10\nP 0')).toBe('11');
        expect(run('use sequences\nP = primes from 11\nP 0')).toBe('11');
        expect(run([
            'use sequences',
            'P = primes from 10',
            'P = P till 20',
            'P',
        ].join('\n'))).toBe('11 13 17 19');
        expect(run([
            'use sequences',
            'P = primes from 100',
            'P = P from 10',
            'P 0',
        ].join('\n'))).toBe('101');
        expect(run([
            'use sequences',
            'F = fibonacci from 8',
            'F = F to 34',
            'F',
        ].join('\n'))).toBe('8 13 21 34');
        // `from` is a condition, so any sequence of comparable values accepts it.
        expect(run('R = 1 to 5\nR from 3')).toBe('3 4 5');
        expect(run('use sequences\nprimes (-1) default 99')).toBe('99');
        expect(() => run('use sequences\n(primes till 10) 4'))
            .toThrowError('sequence index out of bounds: 4');
        expect(run('use sequences\n4 in fibonacci')).toBe('false');
    });

    it('constructs ranges and slices text by Unicode code point', () => {
        expect(run('1 to 4')).toBe('1 2 3 4');
        expect(run('1 to 9 by 2')).toBe('1 3 5 7 9');
        expect(run('1 to 6 by 2')).toBe('1 3 5');
        expect(run('10 till 0 by -2')).toBe('10 8 6 4 2');
        expect(run('10 to 1 by -3')).toBe('10 7 4 1');
        expect(run('1 till 1 by 2')).toBe('');
        expect(run('1 to 1 by 2')).toBe('1');
        expect(() => run('1 to 5 by 0'))
            .toThrowError('range step must be a nonzero integer');
        expect(() => run('use sequences\nfibonacci to 20 by 2'))
            .toThrowError('by applies only to numeric ranges');
        expect(run('"A😀БC" (1 till 3)')).toBe('😀Б');
        expect(run('"A😀БC" (1 to 3)')).toBe('😀БC');
        expect(run('"abcdef" array 4 1 1')).toBe('ebb');
        expect(run('Positions = 1 to 3\n"abcde" Positions')).toBe('bcd');
        expect(run('"abc" array shape 0\nend')).toBe('');
        expect(() => run('"abc" (1 to 3)')).toThrowError();
    });

    it('slices and gathers tensor axes while preserving rank', () => {
        const matrix = [
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
        ];
        const columns = new Interpreter().execute([
            ...matrix,
            'M # (1 till 3)',
        ].join('\n'));
        expect(columns).toMatchObject({ kind: 'array', items: [2n, 3n, 5n, 6n], shape: [2, 2] });

        const rows = new Interpreter().execute([
            ...matrix,
            'M axis 0 array 1 0 1',
        ].join('\n'));
        expect(rows).toMatchObject({
            kind: 'array',
            items: [4n, 5n, 6n, 1n, 2n, 3n, 4n, 5n, 6n],
            shape: [3, 3],
        });

        const reorderedColumns = new Interpreter().execute([
            ...matrix,
            'M axis 1 array 2 0',
        ].join('\n'));
        expect(reorderedColumns).toMatchObject({
            kind: 'array',
            items: [3n, 1n, 6n, 4n],
            shape: [2, 2],
        });
    });

    it('applies integer conversion at text cell ranks', () => {
        expect(run('use text\n"123" integer')).toBe('123');
        expect(run('use text\n"123" integer rank 1')).toBe('123');
        expect(run('use text\n"1203" integer rank 0')).toBe('1 2 0 3');
        expect(() => run('use text\n"12x" integer'))
            .toThrowError('invalid integer text: 12x');
    });

    it('formats scalar text and reverses Unicode code points', () => {
        expect(run('use text\n123 text')).toBe('123');
        expect(run('use text\n-120 text')).toBe('-120');
        expect(run('use text\ntrue text')).toBe('true');
        expect(run('use text\n.Label text')).toBe('.Label');
        expect(run('use sequences\n"A😀Б" reverse')).toBe('Б😀A');
        expect(() => run('use text\n(array 1 2) text'))
            .toThrowError('text expects a scalar value');
        expect(() => run('use sequences\n12 reverse')).toThrowError('reverse expects');
    });

    it('converts Unicode code points and searches text', () => {
        expect(run('use text\n"A" codepoint')).toBe('65');
        expect(run('use text\n"😀" codepoint')).toBe('128512');
        expect(run('use text\n128512 character')).toBe('😀');
        expect(run('"bc" in "abcd"')).toBe('true');
        expect(run('"" in "Rank"')).toBe('true');
        expect(run('"BC" in "abcd"')).toBe('false');
        expect(() => run('use text\n"AB" codepoint'))
            .toThrowError('codepoint expects one Unicode character');
        expect(() => run('use text\n55296 character'))
            .toThrowError('invalid Unicode code point: 55296');
        expect(() => run('use text\n1114112 character'))
            .toThrowError('invalid Unicode code point: 1114112');
    });

    it('checks text prefixes and formats bytes as hexadecimal text', () => {
        expect(run('use text\n"Rank language" "Rank" startswith')).toBe('true');
        expect(run('use text\n"Rank language" "rank" startswith')).toBe('false');
        expect(() => run('use text\n12 "1" startswith'))
            .toThrowError('startswith expects text and a text prefix');
        expect(() => run('use text\n12 hex')).toThrowError('hex expects bytes');
    });

    it('hashes UTF-8 text to MD5 bytes', () => {
        expect(run('use crypto\nuse text\n"abc" md5 hex'))
            .toBe('900150983cd24fb0d6963f7d28e17f72');
        expect(() => run('use crypto\n123 md5')).toThrowError('md5 expects text');
        expect(() => run('"abc" md5')).toThrowError('unknown name: md5');
    });

    it('keeps compact digest bytes addressable before and after tensor operations', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'use crypto',
            'use text',
            'use sequences',
            'Digest = "abc" md5',
            'First = Digest 0',
            'Count = Digest len',
            'Sum = Digest reduce +',
            'Last = Digest 15',
            'Hex = Digest hex',
        ].join('\n'));
        expect(interpreter.variables.get('First')).toBe(144n);
        expect(interpreter.variables.get('Count')).toBe(16n);
        expect(interpreter.variables.get('Sum')).toBe(1960n);
        expect(interpreter.variables.get('Last')).toBe(114n);
        expect(interpreter.variables.get('Hex')).toBe('900150983cd24fb0d6963f7d28e17f72');
    });

    it('formats every byte and empty binary input as hex', () => {
        const io = new MemoryIo({});
        const data = Uint8Array.from({ length: 256 }, (_, index) => index);
        io.files.set('/bytes', data);
        const interpreter = new Interpreter(undefined, { io });
        expect(interpreter.execute('use io\nuse text\n"/bytes" 0 256 readbytes hex'))
            .toBe(Buffer.from(data).toString('hex'));
        expect(interpreter.execute('"/bytes" 256 1 readbytes hex')).toBe('');
    });

    it('splits text by one or several text separators', () => {
        expect(new Interpreter().execute('use text\n"a,b,,c" "," split')).toEqual({
            kind: 'array',
            items: ['a', 'b', '', 'c'],
            shape: [4],
        });
        expect(new Interpreter().execute('use text\n"A😀Б" "" split')).toEqual({
            kind: 'array',
            items: ['A', '😀', 'Б'],
            shape: [3],
        });
        expect(new Interpreter().execute(
            'use text\n"one,two;three" (array "," ";") split',
        )).toEqual({
            kind: 'array',
            items: ['one', 'two', 'three'],
            shape: [3],
        });
        expect(() => run('use text\n12 "," split'))
            .toThrowError('split expects text and a text separator or separator array');
        expect(() => run('use text\n"a,b" (array "" ",") split'))
            .toThrowError('an empty split separator must be used alone');
    });

    it('parses formatted text and explicitly unpacks arrays', () => {
        expect(run([
            'use text',
            'Pattern = "/integerx/integerx/integer"',
            'unpack Length Width Height = "2x3x4" Pattern parse',
            'Length * Width * Height',
        ].join('\n'))).toBe('24');
        expect(new Interpreter().execute([
            'use text',
            'Pattern = "/word//path// /text /real"',
            '"open/path/ remaining text -1.5" Pattern parse',
        ].join('\n'))).toEqual({
            kind: 'tuple',
            items: ['open', 'remaining text', -1.5],
        });
        expect(() => run('use text\n"abc" "/integer" parse'))
            .toThrowError('text does not match format: /integer');
        expect(run([
            'use text',
            'Caught = false',
            'try',
            '  "abc" "/integer" parse',
            'catch .InvalidText Error',
            '  Caught = Error .Value equal "abc"',
            'end',
            'Caught',
        ].join('\n'))).toBe('true');
        expect(run([
            'use text',
            'Pattern = "/integer x /integer"',
            'unpack A B = "2 x 3" Pattern parse',
            'A + B',
        ].join('\n'))).toBe('5');
        expect(() => run('use text\n"abc" "/unknown" parse'))
            .toThrowError('unknown parse directive at position 0');
        expect(() => run('unpack A B = array 1 2 3'))
            .toThrowError('unpack expects 2 values, got 3');
        expect(() => run([
            'unpack A B = array shape 1 2',
            '  1 2',
            'end',
        ].join('\n'))).toThrowError('unpack expects 2 values, got 1');
        expect(run([
            'unpack A # C = array 2 99 5',
            'A * C',
        ].join('\n'))).toBe('10');
    });

    it('unpacks rank-1 arrays into application arguments', () => {
        expect(run([
            'fun area Width Height',
            '  return Width * Height',
            'end',
            'Point = array 3 4',
            'unpack Point area',
        ].join('\n'))).toBe('12');
        expect(run([
            'fun add_nested Values Tail',
            '  return Values 0 + Tail',
            'end',
            'Packed = tuple (array 4) 3',
            'unpack Packed add_nested',
        ].join('\n'))).toBe('7');
        expect(() => run('unpack 1 print'))
            .toThrowError('unpack expects an array or tuple value');
        // A matrix spreads its leading-axis slices: one row here.
        expect(run([
            'use numbers',
            'Matrix = array shape 1 2',
            '  1 2',
            'end',
            'unpack Matrix sum',
        ].join('\n'))).toBe('3');
    });

    it('counts and addresses Unicode text atoms', () => {
        expect(run('use sequences\n"A😀Б" len')).toBe('3');
        expect(run('"A😀Б" 1')).toBe('😀');
        expect(run([
            'Last = ""',
            'for C in "A😀Б"',
            '  Last = C',
            'end',
            'Last',
        ].join('\n'))).toBe('Б');
        expect(run([
            'Last = 0',
            'for C i in "A😀Б"',
            '  Last = i',
            'end',
            'Last',
        ].join('\n'))).toBe('2');
        expect(() => run([
            'for Ci in "A"',
            '  i',
            'end',
        ].join('\n'))).toThrowError('unknown name: i');
    });


});
