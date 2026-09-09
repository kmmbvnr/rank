import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, isRankSequence } from '../src/index.js';

function run(source: string): string | undefined {
    const result = new Interpreter().execute(source);
    return result === undefined ? undefined : formatValue(result);
}

describe('Rank interpreter', () => {
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

    it('raises numbers and collections to powers', () => {
        expect(run('2 ** 10')).toBe('1024');
        expect(run('2 ** 3 ** 2')).toBe('512');
        expect(run('-2 ** 2')).toBe('-4');
        expect(run('(-2) ** 2')).toBe('4');
        expect(run('2 ** -2')).toBe('0.25');
        expect(run('Value = 2\nValue **= 3\nValue')).toBe('8');
        expect(run('use ranges\n(1 to 4) ** 2')).toBe('1 4 9 16');
        expect(run('A = array 2 3\nA A ** outer')).toBe('4 8 9 27');
        expect(() => run('0 ** -1'))
            .toThrowError('zero cannot be raised to a negative power');
        expect(() => run('(-2) ** 0.5')).toThrowError('power result is not real');
    });

    it('applies leading unary operators before postfix calls', () => {
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
        ].join('\n'))).toBe('false');
    });

    it('pads missing addressed values without hiding other errors', () => {
        expect(run('(array 10 20) 2 pad 99')).toBe('99');
        expect(run('(array 10) 0 pad 1 / 0')).toBe('10');
        expect(run('"ab" 2 pad "?"')).toBe('?');
        expect(run('use ranges\n(1 until 3) 2 pad 99')).toBe('99');
        expect(run([
            'use algo',
            'fun lookup Key',
            '  return index Key pad -1',
            'end',
            '7 lookup',
        ].join('\n'))).toBe('-1');
        expect(() => run('(array 10 20) (-1) pad 99'))
            .toThrowError('array index must be nonnegative on axis 0');
        expect(() => run('1 / 0 pad 99')).toThrowError('division by zero');
    });

    it('keeps variables between executions', () => {
        const interpreter = new Interpreter();
        interpreter.execute('Answer = 6 * 7');
        expect(formatValue(interpreter.execute('Answer')!)).toBe('42');
    });

    it('keeps the inferred type of a variable', () => {
        expect(run('Value = 1\nValue = 2')).toBe('2');
        expect(() => run('Value = 1\nValue = 2.0'))
            .toThrowError('Value has type integer and cannot receive real');
        expect(() => run('Value = 1\nValue /= 2'))
            .toThrowError('Value has type integer and cannot receive real');
    });

    it('loads vocabulary without changing the grammar', () => {
        expect(() => run('1 to 3')).toThrowError('to requires: use ranges');
        expect(() => run('3 multiple by 2')).toThrowError('multiple by requires: use numbers');
        expect(run('use ranges\n1 to 3')).toBe('1 2 3');
        expect(run('use ranges\nuse numbers\n(1 to 5) sum')).toBe('15');
    });

    it('broadcasts scalar operations over sequences', () => {
        expect(run('use ranges\n(1 to 3) * 10')).toBe('10 20 30');
        expect(run('use ranges\n1 to 4 greater 2')).toBe('false false true true');
    });

    it('applies binary operations to the outer cells of finite arrays', () => {
        const product = new Interpreter().execute([
            'use ranges',
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

    it('maps and filters an outer tensor lazily', () => {
        expect(run([
            'use ranges',
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
            'use ranges',
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

    it('updates values with compound assignment', () => {
        expect(run('Value = 10\nValue += 5\nValue *= 2\nValue -= 4\nValue //= 2\nValue %= 4\nValue')).toBe('1');
        expect(run('Mask = true\nMask and= true\nMask xor= true\nMask or= true\nMask')).toBe('true');
    });

    it('runs Euler 1 with word operations and a mask', () => {
        const source = [
            'use ranges',
            'use numbers',
            'N = 1 until 1000',
            'Mask = N multiple by 3',
            'Mask or= N multiple by 5',
            'N Mask sum',
        ].join('\n');
        expect(run(source)).toBe('233168');
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

    it('does not reduce an unbounded sequence', () => {
        expect(() => run('use sequences\nuse numbers\nfibonacci sum'))
            .toThrowError('sum requires a bounded sequence');
    });

    it('indexes and bounds lazy prime sequences', () => {
        expect(run('use sequences\nprimes 5')).toBe('13');
        expect(run('use sequences\nprimes until 20')).toBe('2 3 5 7 11 13 17 19');
        expect(() => run('use sequences\nprimes (-1)'))
            .toThrowError('sequence index must be nonnegative');
        expect(() => run('use sequences\n(primes until 10) 4'))
            .toThrowError('sequence index out of bounds: 4');
    });

    it('constructs ranges and slices text by Unicode code point', () => {
        expect(run('use ranges\n1 to 4')).toBe('1 2 3 4');
        expect(run('use ranges\n1 to 9 by 2')).toBe('1 3 5 7 9');
        expect(run('use ranges\n1 to 6 by 2')).toBe('1 3 5');
        expect(run('use ranges\n10 until 0 by 2')).toBe('10 8 6 4 2');
        expect(run('use ranges\n10 to 1 by 3')).toBe('10 7 4 1');
        expect(run('use ranges\n1 until 1 by 2')).toBe('');
        expect(run('use ranges\n1 to 1 by 2')).toBe('1');
        expect(() => run('use ranges\n1 to 5 by 0'))
            .toThrowError('range step must be a positive integer');
        expect(() => run('use ranges\n1 to 5 by -1'))
            .toThrowError('range step must be a positive integer');
        expect(() => run('use sequences\nfibonacci to 20 by 2'))
            .toThrowError('by applies only to numeric ranges');
        expect(run('"A😀БC" from 1 until 3')).toBe('😀Б');
        expect(run('"A😀БC" from 1 to 3')).toBe('😀БC');
        expect(run('"abcdef" array 4 1 1')).toBe('ebb');
        expect(run('use ranges\nPositions = 1 to 3\n"abcde" Positions')).toBe('bcd');
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
        expect(columns).toEqual({ kind: 'array', items: [2n, 3n, 5n, 6n], shape: [2, 2] });

        const rows = new Interpreter().execute([
            ...matrix,
            'M axis 0 array 1 0 1',
        ].join('\n'));
        expect(rows).toEqual({
            kind: 'array',
            items: [4n, 5n, 6n, 1n, 2n, 3n, 4n, 5n, 6n],
            shape: [3, 3],
        });

        const reorderedColumns = new Interpreter().execute([
            ...matrix,
            'M axis 1 array 2 0',
        ].join('\n'));
        expect(reorderedColumns).toEqual({
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

    it('executes nested for and if blocks', () => {
        expect(run([
            'use ranges',
            'Total = 0',
            'for i in 1 to 4',
            '  if i greater 2',
            '    Total += i',
            '  end',
            'end',
            'Total',
        ].join('\n'))).toBe('7');
        expect(run([
            'Result = 0',
            'if false',
            '  Result = 1',
            'else',
            '  Result = 2',
            'end',
            'Result',
        ].join('\n'))).toBe('2');
    });

    it('uses for as a condition-controlled loop', () => {
        expect(run([
            'Count = 0',
            'Total = 0',
            'for Count less 4',
            '  Total += Count',
            '  Count += 1',
            'end',
            'Total',
        ].join('\n'))).toBe('6');
    });

    it('uses bare for as an unconditional loop', () => {
        expect(run([
            'fun repeat_once Value',
            '  for',
            '    return Value',
            '  end',
            'end',
            '7 repeat_once',
        ].join('\n'))).toBe('7');
    });

    it('breaks out of the nearest for loop', () => {
        expect(run([
            'use ranges',
            'Total = 0',
            'for i in 1 to 3',
            '  for j in 1 to 3',
            '    if j equal 2',
            '      break',
            '    end',
            '    Total += 1',
            '  end',
            'end',
            'Total',
        ].join('\n'))).toBe('3');
        expect(run([
            'Count = 0',
            'for',
            '  Count += 1',
            '  break',
            'end',
            'Count',
        ].join('\n'))).toBe('1');
        expect(() => run('break'))
            .toThrowError('break is only valid inside a for loop');
    });

    it('catches typed runtime errors as values', () => {
        expect(run([
            'use text',
            'try',
            '  Value = "bad" integer',
            'catch .InvalidNumber Error',
            '  Kind = Error .Kind',
            '  Message = Error .Message',
            '  Original = Error .Value',
            '  Value = 0',
            'end',
            'Kind equal .InvalidNumber and Original equal "bad" and Value equal 0',
        ].join('\n'))).toBe('true');
    });

    it('raises, catches and rethrows user errors', () => {
        expect(run([
            'try',
            '  try',
            '    .InvalidAge 17 raise',
            '  catch .InvalidAge Error',
            '    Error raise',
            '  end',
            'catch .InvalidAge Outer',
            '  Outer .Value',
            'end',
        ].join('\n'))).toBe('17');
        expect(run([
            'try',
            '  .Failure "could not continue" raise',
            'catch Error',
            '  Error .Message',
            'end',
        ].join('\n'))).toBe('could not continue');
        expect(() => run('.InvalidAge 17 raise'))
            .toThrowError('.InvalidAge: 17');
    });

    it('always executes finally and preserves cleanup causes', () => {
        expect(run([
            'Count = 0',
            'try',
            '  Count = 1',
            'finally',
            '  Count += 1',
            'end',
            'Count',
        ].join('\n'))).toBe('2');
        expect(run([
            'Handled = false',
            'Clean = false',
            'try',
            '  .Failure raise',
            'catch .Failure Error',
            '  Handled = true',
            'finally',
            '  Clean = true',
            'end',
            'Handled and Clean',
        ].join('\n'))).toBe('true');
        expect(run([
            'Count = 0',
            'for',
            '  try',
            '    break',
            '  finally',
            '    Count += 1',
            '  end',
            'end',
            'Count',
        ].join('\n'))).toBe('1');
        expect(run([
            'try',
            '  try',
            '    .Original "first" raise',
            '  finally',
            '    .Cleanup "second" raise',
            '  end',
            'catch .Cleanup Error',
            '  Cause = Error .Cause',
            '  Cause .Kind',
            'end',
        ].join('\n'))).toBe('.Original');
    });

    it('executes finally before returning from a function', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        const result = interpreter.execute([
            'use io',
            'fun answer Ignored',
            '  try',
            '    return 42',
            '  finally',
            '    "clean" print',
            '  end',
            'end',
            '0 answer',
        ].join('\n'));
        expect(result && formatValue(result)).toBe('42');
        expect(lines).toEqual(['clean']);
    });

    it('rejects return and break inside finally', () => {
        expect(() => run([
            'fun answer Ignored',
            '  try',
            '    return 1',
            '  finally',
            '    return 2',
            '  end',
            'end',
            '0 answer',
        ].join('\n'))).toThrowError('return is not valid inside finally');
        expect(() => run([
            'for',
            '  try',
            '    1',
            '  finally',
            '    break',
            '  end',
            'end',
        ].join('\n'))).toThrowError('break is not valid inside finally');
    });

    it('does not catch return or break as errors', () => {
        expect(run([
            'fun answer Ignored',
            '  try',
            '    return 42',
            '  catch Error',
            '    return 0',
            '  end',
            'end',
            '0 answer',
        ].join('\n'))).toBe('42');
        expect(run([
            'Count = 0',
            'for',
            '  try',
            '    break',
            '  catch Error',
            '    Count = 99',
            '  end',
            'end',
            'Count',
        ].join('\n'))).toBe('0');
    });

    it('calls user functions with local indexes and returns arrays', () => {
        expect(run([
            'use algo',
            'fun two_sum A Target',
            '  for Value i in A',
            '    Need = Target - Value',
            '    if Need in index',
            '      J = index Need',
            '      return array J i',
            '    end',
            '    index Value = i',
            '  end',
            'end',
            'A = array 2 7 11 15',
            'Answer = A 9 two_sum',
            'Answer 1',
        ].join('\n'))).toBe('1');
    });

    it('registers top-level functions before executing the file', () => {
        expect(run([
            'Answer = 41 next',
            'fun next X',
            '  return X + 1',
            'end',
            'Answer',
        ].join('\n'))).toBe('42');

        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/example_test.ra',
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: [
                    'TopLevel = 99',
                    'fun next X',
                    '  return X + 1',
                    'end',
                ].join('\n'),
            }),
        });
        expect(interpreter.execute('use "worker"\n41 next')).toBe(42n);
        expect(interpreter.variables.has('TopLevel')).toBe(false);
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
        expect(run('use numbers\n3 2 min')).toBe('2');
        expect(run('use numbers\n3 2 max')).toBe('3');
        expect(run('use numbers\n-infinity')).toBe('-infinity');
        expect(run('use numbers\noption Rate real = 1.5\nRate')).toBe('1.5');
    });

    it('calls operations after their data', () => {
        expect(run('use numbers\n54 24 gcd')).toBe('6');
        expect(run('use numbers\n8 12 lcm')).toBe('24');
        expect(run('use ranges\nuse numbers\n(1 to 10) lcm')).toBe('2520');
        expect(() => run('use numbers\ngcd 54 24'))
            .toThrowError('operation must follow its data: gcd');
    });

    it('uses function arity to group an addressed first argument', () => {
        expect(run([
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'fun above Value Limit',
            '  return Value greater Limit',
            'end',
            'M 1 0 2 above',
        ].join('\n'))).toBe('true');
        expect(() => run([
            'fun add A B',
            '  return A + B',
            'end',
            '1 2 3 add',
        ].join('\n'))).toThrowError('add expects 2 arguments, got 3');
    });

    it('rejects names from modules that were not imported', () => {
        expect(() => run('sum 1')).toThrowError(RankError);
        expect(() => run('sum 1')).toThrowError('unknown name: sum');
    });

    it('sends print output through an injected function', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        expect(formatValue(interpreter.execute('use io\n42 print')!)).toBe('42');
        expect(lines).toEqual(['42']);
    });

    it('resolves program inputs as workspace, args, then default', () => {
        const source = 'use cli\noption Limit integer = 1000\nLimit';
        expect(new Interpreter(undefined, { args: ['--limit', '20'] }).execute(source)).toBe(20n);

        const interpreter = new Interpreter(undefined, { args: ['--limit', '20'] });
        interpreter.variables.set('Limit', 10n);
        expect(interpreter.execute(source)).toBe(10n);
        expect(run(source)).toBe('1000');
    });

    it('loads an open program and runs it in the current workspace', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/example_test.ra',
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        expect(interpreter.execute('use "worker"\nLimit = 10\nrun\nAnswer')).toBe(11n);
    });

    it('runs a program through an explicit module alias', () => {
        const interpreter = new Interpreter(undefined, {
            loadModule: specifier => ({
                id: specifier,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        expect(interpreter.execute('use "worker" as W\nW.Limit = 20\nW.run\nW.Answer')).toBe(21n);
    });

    it('executes isolated Rank test blocks', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/worker_test.ra',
            testing: true,
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        interpreter.execute([
            'use testing',
            'test "workspace input"',
            '  use "worker"',
            '  Limit = 10',
            '  run',
            '  Answer equal 11',
            'end',
            'test "false result"',
            '  1 equal 2',
            'end',
            'test "matching arrays"',
            '  Answer = array 7 0 8',
            '  Answer equal array 7 0 8',
            'end',
            'test "different arrays"',
            '  Answer = array 7 0 8',
            '  Answer equal array 7 1 8',
            'end',
            'test "matching tensors"',
            '  Answer = array shape 2 2',
            '    1 2',
            '    3 4',
            '  end',
            '  Answer equal array shape 2 2',
            '    1 2',
            '    3 4',
            '  end',
            'end',
            'test "different shapes"',
            '  Answer = array shape 1 3',
            '    7 0 8',
            '  end',
            '  Answer equal array 7 0 8',
            'end',
        ].join('\n'));
        expect(interpreter.testResults).toEqual([
            { name: 'workspace input', passed: true, output: [] },
            {
                name: 'false result',
                passed: false,
                output: [],
                error: 'boolean test expression evaluated to false',
            },
            { name: 'matching arrays', passed: true, output: [] },
            {
                name: 'different arrays',
                passed: false,
                output: [],
                error: 'boolean test expression evaluated to false',
            },
            { name: 'matching tensors', passed: true, output: [] },
            {
                name: 'different shapes',
                passed: false,
                output: [],
                error: 'shape mismatch: 1,3 and 3',
            },
        ]);
    });

    it('compares a function-local queue with a rank-one array', () => {
        const interpreter = new Interpreter(undefined, { testing: true });
        interpreter.execute([
            'use testing',
            'test "queue result"',
            '  use algo',
            '  fun result Ignored',
            '    queue push 7',
            '    queue push 0',
            '    queue push 8',
            '    return queue',
            '  end',
            '  Answer = 0 result',
            '  Answer equal array 7 0 8',
            'end',
        ].join('\n'));
        expect(interpreter.testResults).toEqual([
            { name: 'queue result', passed: true, output: [] },
        ]);
    });
});
