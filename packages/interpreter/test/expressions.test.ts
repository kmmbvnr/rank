import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankSequence } from '../src/index.js';
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
            .toThrowError('ordered values must be comparable scalars');
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
        expect(run('A = array 2 3\nA A ** outer')).toBe('4 8 9 27');
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
        expect(run('(1 until 3) 2 default 99')).toBe('99');
        expect(run([
            'use algo',
            'fun lookup Key',
            '  return index Key default -1',
            'end',
            '7 lookup',
        ].join('\n'))).toBe('-1');
        expect(() => run('(array 10 20) (-1) default 99'))
            .toThrowError('array index must be nonnegative on axis 0');
        expect(() => run('1 / 0 default 99')).toThrowError('division by zero');
    });

    it('defaults sparse reads lazily without swallowing key or fallback errors', () => {
        const source = [
            'use algo',
            'fun lookup Mode',
            '  index 1 2 = false',
            '  if Mode equal 0',
            '    return index 1 2 default 1 / 0',
            '  end',
            '  if Mode equal 1',
            '    return index 2 3 default 42',
            '  end',
            '  if Mode equal 2',
            '    return index (1 / 0) 3 default 42',
            '  end',
            '  return index 2 3 default index 9 9',
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
        expect(run([
            'Values = array 1 "two" true',
            'Result = ""',
            'for Value i in Values',
            '  if Value is .integer',
            '    Result += "i"',
            '  end',
            '  if Value is .text',
            '    Result += "t"',
            '  end',
            '  if Value is .boolean',
            '    Result += "b"',
            '  end',
            'end',
            'Result',
        ].join('\n'))).toBe('itb');
        expect(() => run([
            'Values = array 1 "two"',
            'for Value in Values',
            '  Value = Value',
            'end',
            'Value = true',
        ].join('\n'))).toThrowError(
            'Value has type integer or text and cannot receive boolean',
        );
        expect(() => run('42 is "integer"'))
            .toThrowError('is expects a type symbol on the right');
        expect(() => run('42 is .number'))
            .toThrowError('unknown type symbol: .number');
    });

    it('loads vocabulary without changing the grammar', () => {
        expect(run('1 to 3')).toBe('1 2 3');
        expect(() => run('3 multiple by 2')).toThrowError('multiple by requires: use numbers');
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
            'A B * outer',
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
            'A B + outer',
        ].join('\n'));
        expect(tensor).toMatchObject({ kind: 'array', shape: [2, 2, 2] });
        expect(tensor && typeof tensor === 'object' && tensor.kind === 'array'
            ? tensor.items
            : undefined).toEqual([11n, 21n, 12n, 22n, 13n, 23n, 14n, 24n]);
        expect(run([
            'A = array 1 3',
            'B = array 2 4',
            'A B less outer',
        ].join('\n'))).toBe('true true false true');
    });

    it('applies named binary functions with intrinsic ranks under outer', () => {
        const xor = new Interpreter().execute([
            'use bits',

            'Values = 0 until 3',
            'Operation = bxor',
            'Values Values Operation outer',
        ].join('\n'));
        expect(xor).toMatchObject({ kind: 'array', shape: [3, 3] });
        expect(xor && typeof xor === 'object' && xor.kind === 'array'
            ? xor.items
            : undefined).toEqual([0n, 1n, 2n, 1n, 0n, 3n, 2n, 3n, 0n]);

        expect(run([
            'use numbers',
            'A = array 3 1',
            'B = array 2 4',
            'A B min outer',
        ].join('\n'))).toBe('2 3 1 1');

        expect(run([
            'use bits',
            'A = array 1 "invalid"',
            'B = array 2',
            'Grid = A B bxor outer',
            'Grid 0 0',
        ].join('\n'))).toBe('3');

        const whole = new Interpreter().execute([
            'use numbers',
            'A = array 1 2',
            'B = array 3 4',
            'Result = A B whole outer',
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
            'A A abs outer',
        ].join('\n'))).toThrowError('outer operation abs must accept 2 arguments');
        expect(() => run([
            'A = array 1',
            'B = array 2',
            'Result = A B pair outer',
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
            '  return X % 2 equal 0',
            'end',
            'A = 1 to 3',
            'Products = A A * outer',
            'Mask = Products even_value rank 0',
            'Selected = Products Mask',
            'Selected sum',
        ].join('\n'))).toBe('20');
        expect(() => run('use sequences\nfibonacci fibonacci * outer'))
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
            'Windows * reduce rank 1',
        ].join('\n'))).toBe('6 24');
        expect(run('use sequences\n(array 1 2) 3 window')).toBe('');
        expect(() => run('use sequences\n(array 1 2) 0 window'))
            .toThrowError('window sizes must be positive integers');
        expect(() => run('(array 1 2) 2 window'))
            .toThrowError('unknown name: window');
        expect(run([
            'use sequences',
            'Pairs = (primes until 10) 2 window',
            'Pair = Pairs 2',
            'Pair + reduce',
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
            'Windows + reduce rank 2',
        ].join('\n'))).toBe('14 18 22 30 34 38');
        expect(run([
            ...source,
            'Windows = M 3 window axis 1',
            'Windows + reduce rank 1',
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
            '  queue push 1',
            '  queue push 2',
            '  queue push 3',
            '  queue push 4',
            '  return queue (array 2 2) reshape',
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

    it('reduces complete values and trailing cells', () => {
        expect(run('(array 2 3 4) * reduce')).toBe('24');
        expect(run('(array 1 2 3) + reduce')).toBe('6');
        expect(run('(array true true false) and reduce')).toBe('false');
        const empty = 'Empty = array shape 0\nend\nEmpty';
        expect(run(`${empty} + reduce`)).toBe('0');
        expect(run(`${empty} * reduce`)).toBe('1');
        expect(() => run(`${empty} - reduce`))
            .toThrowError('- reduce does not define a value for an empty cell');
        expect(() => run('use sequences\nfibonacci + reduce'))
            .toThrowError('+ reduce requires a bounded sequence');
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
        expect(() => run('use sequences\n(array true 1) all'))
            .toThrowError('all expects boolean values');
        expect(() => run('use sequences\n(array true 1) count'))
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
        expect(() => run('use sequences\n(array true 1) indices'))
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
        expect(run('Value = 10\nValue += 5\nValue *= 2\nValue -= 4\nValue //= 2\nValue %= 4\nValue')).toBe('1');
        expect(run('Mask = true\nMask and= true\nMask xor= true\nMask or= true\nMask')).toBe('true');
    });

    it('runs Euler 1 with word operations and a mask', () => {
        const source = [

            'use numbers',
            'N = 1 until 1000',
            'Mask = N multiple by 3',
            'Mask or= N multiple by 5',
            'N Mask sum',
        ].join('\n');
        expect(run(source)).toBe('233168');
    });

    it('combines masks from repeated built-in sequence references', () => {
        expect(run('use sequences\nuse numbers\n(fibonacci multiple by 5 or fibonacci multiple by 3) to 100'))
            .toBe('3 5 21 55');
        expect(run('use sequences\nuse numbers\n(primes multiple by 5 or primes multiple by 3) to 100'))
            .toBe('3 5');
        expect(() => run('use sequences\nuse numbers\nfibonacci even or primes even'))
            .toThrowError('cannot combine masks from different sequences');
    });

    it('bounds and filters Fibonacci lazily', () => {
        const interpreter = new Interpreter();
        const result = interpreter.execute([
            'use sequences',
            'use numbers',
            'Fib = fibonacci to 100',
            'Mask = Fib even',
            'Mask sum',
        ].join('\n'));
        expect(formatValue(result!)).toBe('44');

        const mask = interpreter.variables.get('Mask');
        expect(mask && isRankSequence(mask) && mask.plan.name).toBe('even fibonacci');
        expect(mask && isRankSequence(mask) && mask.plan.size)
            .toEqual({ kind: 'exact', value: 3n });

        expect(run([
            'use sequences',
            'use numbers',
            'Fib = fibonacci to 100',
            'Mask = Fib even',
            'Fib Mask sum',
        ].join('\n'))).toBe('44');
        expect(run([
            'use sequences',
            'use numbers',
            'Fib = fibonacci to 100',
            'Fib even sum',
        ].join('\n'))).toBe('44');
        expect(run([
            'use sequences',
            'use numbers',
            'Fib = fibonacci to 100',
            'Fib even 1',
        ].join('\n'))).toBe('8');
        expect(run([
            'use sequences',
            'use numbers',
            'Total = 0',
            'Fib = fibonacci to 100',
            'for Value i in Fib even',
            '  Total += Value',
            'end',
            'Total',
        ].join('\n'))).toBe('44');
        expect(run([
            'use sequences',
            'use numbers',
            'Fib = fibonacci to 100',
            'Pairs = Fib even 2 window',
            'Pairs 1 + reduce',
        ].join('\n'))).toBe('42');
    });

    it('bounds a mask over an endless sequence', () => {
        // A value bound and a filter keep the same items in either order, so a
        // mask offers the bounds its source offers.
        expect(run('use sequences\nuse numbers\n(primes multiple by 5) until 100'))
            .toBe('5');
        expect(run('use sequences\nuse numbers\n(fibonacci multiple by 2) until 100'))
            .toBe('2 8 34');
        expect(run('use sequences\nuse numbers\nB = primes multiple by 3\nB until 20'))
            .toBe('3');
        expect(run([
            'use sequences',
            'use numbers',
            'F = fibonacci multiple by 2',
            'G = F from 10',
            'G until 100',
        ].join('\n'))).toBe('34');
        // A source without bounds still says so rather than running forever.
        expect(() => run('use numbers\n(1 until 20 multiple by 3) until 10'))
            .toThrowError('does not support until');
    });

    it('does not reduce an unbounded sequence', () => {
        expect(() => run('use sequences\nuse numbers\nfibonacci sum'))
            .toThrowError('sum requires a bounded sequence');
    });

    it('indexes and bounds lazy prime sequences', () => {
        expect(run('use sequences\nprimes 5')).toBe('13');
        expect(run('use sequences\nprimes until 20')).toBe('2 3 5 7 11 13 17 19');
        expect(run('use sequences\n17 in primes')).toBe('true');
        expect(run('use sequences\n17.0 in primes')).toBe('true');
        expect(run('use sequences\n18 in primes')).toBe('false');
        expect(run('use sequences\n23 in (primes until 20)')).toBe('false');
        expect(run('use sequences\n8 in (fibonacci to 20)')).toBe('true');
        expect(run('use sequences\nP = primes from 10\nP 0')).toBe('11');
        expect(run('use sequences\nP = primes from 11\nP 0')).toBe('11');
        expect(run([
            'use sequences',
            'P = primes from 10',
            'P = P until 20',
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
        expect(() => run([

            'R = 1 to 5',
            'R from 3',
        ].join('\n'))).toThrowError('does not support from');
        expect(() => run('use sequences\nprimes (-1)'))
            .toThrowError('sequence index must be nonnegative');
        expect(() => run('use sequences\n(primes until 10) 4'))
            .toThrowError('sequence index out of bounds: 4');
        expect(run('use sequences\n4 in fibonacci')).toBe('false');
    });

    it('constructs ranges and slices text by Unicode code point', () => {
        expect(run('1 to 4')).toBe('1 2 3 4');
        expect(run('1 to 9 by 2')).toBe('1 3 5 7 9');
        expect(run('1 to 6 by 2')).toBe('1 3 5');
        expect(run('10 until 0 by -2')).toBe('10 8 6 4 2');
        expect(run('10 to 1 by -3')).toBe('10 7 4 1');
        expect(run('1 until 1 by 2')).toBe('');
        expect(run('1 to 1 by 2')).toBe('1');
        expect(() => run('1 to 5 by 0'))
            .toThrowError('range step must be a nonzero integer');
        expect(() => run('use sequences\nfibonacci to 20 by 2'))
            .toThrowError('by applies only to numeric ranges');
        expect(run('"A😀БC" from 1 until 3')).toBe('😀Б');
        expect(run('"A😀БC" from 1 to 3')).toBe('😀БC');
        expect(run('"abcdef" array 4 1 1')).toBe('ebb');
        expect(run('Positions = 1 to 3\n"abcde" Positions')).toBe('bcd');
        expect(run('"abc" array shape 0\nend')).toBe('');
        expect(() => run('"abc" from 1 to 3'))
            .toThrowError('slice 1 to 3 exceeds axis size 3');
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
            'M axis 1 from 1 until 3',
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
        expect(run('use text\n"A😀Б" reverse')).toBe('Б😀A');
        expect(() => run('use text\n(array 1 2) text'))
            .toThrowError('text expects a scalar value');
        expect(() => run('use text\n12 reverse')).toThrowError('reverse expects text');
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
            'Sum = Digest + reduce',
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
            kind: 'array',
            items: ['open', 'remaining text', -1.5],
            shape: [3],
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
        ].join('\n'))).toThrowError('unpack expects a rank-1 array value');
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
            'Packed = array (array 4) 3',
            'unpack Packed add_nested',
        ].join('\n'))).toBe('7');
        expect(() => run('unpack 1 print'))
            .toThrowError('unpack expects an array value');
        expect(() => run([
            'Matrix = array shape 1 2',
            '  1 2',
            'end',
            'unpack Matrix print',
        ].join('\n'))).toThrowError('unpack expects a rank-1 array value');
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
