import { describe, expect, it } from 'vitest';
import {
    Interpreter,
    RankError,
    formatValue,
    isRankSequence,
    type RankInput,
    type RankFileHandle,
    type RankFileMode,
    type RankIo,
} from '../src/index.js';

function run(source: string): string | undefined {
    const result = new Interpreter().execute(source);
    return result === undefined ? undefined : formatValue(result);
}

class TokenInput implements RankInput {
    private offset = 0;

    constructor(private readonly tokens: readonly string[]) {}

    readToken(): string | undefined {
        return this.tokens[this.offset++];
    }

    get reads(): number {
        return this.offset;
    }
}

class MemoryIo implements RankIo {
    readonly files = new Map<string, Uint8Array>();
    readonly handles: MemoryFile[] = [];

    constructor(files: Record<string, string>) {
        const encoder = new TextEncoder();
        for (const [path, text] of Object.entries(files)) {
            this.files.set(path, encoder.encode(text));
        }
    }

    read(path: string): Uint8Array {
        return this.file(path).slice();
    }

    readRange(path: string, offset: number, count: number): Uint8Array {
        return this.file(path).slice(offset, offset + count);
    }

    write(path: string, data: Uint8Array, append: boolean): void {
        const previous = append ? this.files.get(path) ?? new Uint8Array() : new Uint8Array();
        const result = new Uint8Array(previous.length + data.length);
        result.set(previous);
        result.set(data, previous.length);
        this.files.set(path, result);
    }

    open(path: string, mode: RankFileMode): RankFileHandle {
        if (mode === 'read' || mode === 'update') this.file(path);
        if (mode === 'write') this.files.set(path, new Uint8Array());
        if (mode === 'append' && !this.files.has(path)) this.files.set(path, new Uint8Array());
        const handle = new MemoryFile(this, path, mode);
        this.handles.push(handle);
        return handle;
    }

    file(path: string): Uint8Array {
        const data = this.files.get(path);
        if (!data) throw new Error('file does not exist');
        return data;
    }
}

class MemoryFile implements RankFileHandle {
    positionValue: number;
    closed = false;

    constructor(
        private readonly io: MemoryIo,
        readonly name: string,
        private readonly mode: RankFileMode,
    ) {
        this.positionValue = mode === 'append' ? this.size() : 0;
    }

    read(count: number): Uint8Array {
        this.ensureOpen();
        const data = this.io.file(this.name).slice(this.positionValue, this.positionValue + count);
        this.positionValue += data.length;
        return data;
    }

    write(data: Uint8Array): void {
        this.ensureOpen();
        if (this.mode === 'read') throw new Error('file is read-only');
        if (this.mode === 'append') {
            this.io.write(this.name, data, true);
            this.positionValue = this.size();
            return;
        }
        const previous = this.io.file(this.name);
        const size = Math.max(previous.length, this.positionValue + data.length);
        const result = new Uint8Array(size);
        result.set(previous);
        result.set(data, this.positionValue);
        this.io.files.set(this.name, result);
        this.positionValue += data.length;
    }

    seek(offset: number): void {
        this.ensureOpen();
        this.positionValue = offset;
    }

    position(): number {
        this.ensureOpen();
        return this.positionValue;
    }

    size(): number {
        this.ensureOpen();
        return this.io.file(this.name).length;
    }

    flush(): void {
        this.ensureOpen();
    }

    close(): void {
        this.closed = true;
    }

    private ensureOpen(): void {
        if (this.closed) throw new Error('file is closed');
    }
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

    it('pads sparse reads lazily without swallowing key or fallback errors', () => {
        const source = [
            'use algo',
            'fun lookup Mode',
            '  index 1 2 = false',
            '  if Mode equal 0',
            '    return index 1 2 pad 1 / 0',
            '  end',
            '  if Mode equal 1',
            '    return index 2 3 pad 42',
            '  end',
            '  if Mode equal 2',
            '    return index (1 / 0) 3 pad 42',
            '  end',
            '  return index 2 3 pad index 9 9',
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

    it('applies named binary functions with intrinsic ranks under outer', () => {
        const xor = new Interpreter().execute([
            'use bits',
            'use ranges',
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

    it('reshapes finite values in row-major order', () => {
        const matrix = new Interpreter().execute([
            'use sequences',
            'use ranges',
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

    it('selects the first true elif branch', () => {
        expect(run([
            'Value = 1',
            'Result = "none"',
            'if Value less 0',
            '  Result = "negative"',
            'elif Value equal 1',
            '  Result = "one"',
            'elif 1 / 0 equal 0',
            '  Result = "unreachable"',
            'else',
            '  Result = "other"',
            'end',
            'Result',
        ].join('\n'))).toBe('one');
        expect(run([
            'if false',
            '  Result = 1',
            'elif false',
            '  Result = 2',
            'else',
            '  Result = 3',
            'end',
            'Result',
        ].join('\n'))).toBe('3');
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

    it('registers local functions early and captures their lexical workspace', () => {
        expect(run([
            'fun total N',
            '  return N adddown',
            '',
            '  fun adddown Value',
            '    if Value equal 0',
            '      return 0',
            '    end',
            '    return Value + ((Value - 1) adddown)',
            '  end',
            'end',
            '5 total',
        ].join('\n'))).toBe('15');

        expect(run([
            'fun make Base',
            '  return add',
            '',
            '  fun add Value',
            '    Base += 1',
            '    return Base + Value',
            '  end',
            'end',
            'A = 10 make',
            'B = 20 make',
            'First = 0 A',
            'Second = 0 A',
            'Other = 0 B',
            'array First Second Other',
        ].join('\n'))).toBe('11 12 21');
    });

    it('uses lexical rather than caller-local function lookup', () => {
        expect(() => run([
            'fun caller X',
            '  return 1 helper',
            'end',
            'fun helper Y',
            '  return X + Y',
            'end',
            '3 caller',
        ].join('\n'))).toThrowError('unknown name: X');
    });

    it('keeps captured local generators alive after their outer call', () => {
        expect(run([
            'use ranges',
            'fun multiples Factor',
            '  return values',
            '',
            '  fun values Limit',
            '    for Value in 1 to Limit',
            '      yield Value * Factor',
            '    end',
            '  end',
            'end',
            'Twos = 2 multiples',
            '3 Twos array',
        ].join('\n'))).toBe('2 4 6');
    });

    it('reevaluates prepared loop sources and assignments on each call', () => {
        expect(run([
            'fun total Values',
            '  Sum = 0',
            '  for Value i in Values',
            '    Sum += Value + i',
            '  end',
            '  return Sum',
            'end',
            'A = array 2 3',
            'First = A total',
            'A 0 = 10',
            'Second = A total',
            'B = array 7',
            'array First Second (B total)',
        ].join('\n'))).toBe('6 14 7');
    });

    it('preserves catch and finally across prepared generator commands', () => {
        expect(run([
            'use ranges',
            'fun values Base',
            '  try',
            '    for I in 0 until 2',
            '      yield Base + I',
            '    end',
            '    .Failure raise',
            '  catch .Failure Error',
            '    yield Base + 2',
            '  finally',
            '    yield Base + 3',
            '  end',
            'end',
            'A = 10 values array',
            'B = 20 values array',
            '(A equal (array 10 11 12 13)) and (B equal (array 20 21 22 23))',
        ].join('\n'))).toBe('true true true true');
    });

    it('prepares operands only when execution reaches them', () => {
        expect(run([
            'fun fail N',
            '  .First raise',
            '  return N',
            'end',
            'try',
            '  Answer = (0 fail) (1 abs rank Bad)',
            'catch .First Error',
            '  true',
            'end',
        ].join('\n'))).toBe('true');
    });

    it('allocates arrays afresh when executing the same function body', () => {
        expect(run([
            'fun make Value',
            '  Data = array shape 2 pad Value',
            '  return Data',
            'end',
            'A = 1 make',
            'B = 2 make',
            'A 0 = 9',
            'array (A 0) (A 1) (B 0) (B 1)',
        ].join('\n'))).toBe('9 1 2 2');
    });

    it('restores the caller frame after a captured function raises', () => {
        expect(run([
            'fun make Base',
            '  return fail',
            '  fun fail N',
            '    Base += N',
            '    .Failure Base raise',
            '    return 0',
            '  end',
            'end',
            'fun caller N',
            '  F = N make',
            '  try',
            '    1 F',
            '  catch .Failure Error',
            '    N += 10',
            '  end',
            '  return N',
            'end',
            'array (2 caller) (5 caller)',
        ].join('\n'))).toBe('12 15');
    });

    it('keeps frames separate when generators from the same body interleave', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun values Base',
            '  yield Base',
            '  Base += 1',
            '  yield Base',
            'end',
            'A = 10 values',
            'B = 20 values',
        ].join('\n'));
        const a = interpreter.variables.get('A')!;
        const b = interpreter.variables.get('B')!;
        if (!isRankSequence(a) || !isRankSequence(b)) throw new Error('expected sequences');
        const left = a.plan.iterate();
        const right = b.plan.iterate();
        expect(left.next().value).toBe(10n);
        expect(right.next().value).toBe(20n);
        expect(left.next().value).toBe(11n);
        expect(right.next().value).toBe(21n);
        expect(left.next().done).toBe(true);
        expect(right.next().done).toBe(true);
        interpreter.dispose();
    });

    it('rejects conditional local function declarations', () => {
        expect(() => run([
            'fun outer Enabled',
            '  if Enabled',
            '    fun inner Value',
            '      return Value',
            '    end',
            '  end',
            '  return 0',
            'end',
            'true outer',
        ].join('\n'))).toThrowError(
            'a local function must be declared directly inside a function',
        );
    });

    it('keeps a source function attached to its module vocabulary', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/example_test.ra',
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: [
                    'use text',
                    'fun pieces Text',
                    '  return Text "," split',
                    'end',
                ].join('\n'),
            }),
        });
        expect(interpreter.execute('use "worker"\n"a,b" pieces')).toEqual({
            kind: 'array',
            items: ['a', 'b'],
            shape: [2],
        });
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

    it('calls operations after their data', () => {
        expect(run('use numbers\n54 24 gcd')).toBe('6');
        expect(run('use numbers\n8 12 lcm')).toBe('24');
        expect(run('use ranges\nuse numbers\n(1 to 10) lcm')).toBe('2520');
        expect(run('use numbers\n7 0 13 powmod')).toBe('1');
        expect(run('use numbers\n7 4 13 powmod')).toBe('9');
        expect(run('use numbers\n-2 3 5 powmod')).toBe('2');
        expect(run('use numbers\n9 0 1 powmod')).toBe('0');
        expect(() => run('use numbers\n2 (-1) 5 powmod'))
            .toThrowError('powmod exponent must be nonnegative');
        expect(() => run('use numbers\n2 3 0 powmod'))
            .toThrowError('powmod modulus must be positive');
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

    it('reads word and integer tokens from standard input', () => {
        const interpreter = new Interpreter(undefined, {
            input: new TokenInput(['Rank', '-1203', '+7']),
        });
        expect(interpreter.execute([
            'use io',
            'Word = stdin .word',
            'A = stdin .integer',
            'B = stdin .integer',
            'array Word (A + B)',
        ].join('\n'))).toEqual({ kind: 'array', items: ['Rank', -1196n], shape: [2] });

        expect(() => new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .integer')).toThrowError('standard input ended before .integer');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput(['12x']),
        }).execute('use io\nstdin .integer')).toThrowError('invalid integer input: 12x');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput(['1']),
        }).execute('stdin .integer')).toThrowError('stdin requires: use io');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput(['x']),
        }).execute('use io\nstdin .line')).toThrowError('unsupported standard input mode: .line');
    });

    it('reads a counted standard-input sequence lazily and once', () => {
        const input = new TokenInput(['10', '20', 'tail']);
        const interpreter = new Interpreter(undefined, { input });
        interpreter.execute([
            'use io',
            'Values = stdin .integer 2',
        ].join('\n'));

        expect(input.reads).toBe(0);
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values) && values.plan.size)
            .toEqual({ kind: 'exact', value: 2n });
        expect(interpreter.execute('Values array'))
            .toEqual({ kind: 'array', items: [10n, 20n], shape: [2] });
        expect(input.reads).toBe(2);
        expect(() => interpreter.execute('Values array'))
            .toThrowError('standard input sequence .integer has already been consumed');
        expect(interpreter.execute('stdin .word 1 array'))
            .toEqual({ kind: 'array', items: ['tail'], shape: [1] });

        expect(new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .word 0 array'))
            .toEqual({ kind: 'array', items: [], shape: [0] });
        expect(() => new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .integer (-1)'))
            .toThrowError('stdin count must be a nonnegative integer');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .integer 1.5'))
            .toThrowError('stdin count must be a nonnegative integer');

        const short = new Interpreter(undefined, { input: new TokenInput(['1']) });
        short.execute('use io\nValues = stdin .integer 2');
        expect(() => short.execute('Values array'))
            .toThrowError('standard input ended before .integer');

        const invalid = new Interpreter(undefined, { input: new TokenInput(['x']) });
        invalid.execute('use io\nValues = stdin .integer 1');
        expect(() => invalid.execute('Values array'))
            .toThrowError('invalid integer input: x');
    });

    it('runs user generator functions lazily and once', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun values N',
            '  Current = N',
            '  for Current greater 0',
            '    yield Current',
            '    Current -= 1',
            '  end',
            'end',
            'Values = 3 values',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        expect(formatValue(values)).toBe('3 2 1');
        expect(() => formatValue(values))
            .toThrowError('generator sequence values has already been consumed');
    });

    it('materializes a finite sequence with postfix array', () => {
        expect(run([
            'fun values N',
            '  for N greater 0',
            '    yield N',
            '    N -= 1',
            '  end',
            'end',
            'Values = 3 values array',
            'Values',
        ].join('\n'))).toBe('3 2 1');
        expect(run([
            'fun none N',
            '  if N greater 0',
            '    yield N',
            '  end',
            'end',
            '0 none array',
        ].join('\n'))).toBe('');
        expect(() => run('use sequences\nprimes array'))
            .toThrowError('cannot materialize an infinite sequence');
        expect(() => run('42 array'))
            .toThrowError('postfix array expects a sequence');
    });

    it('supports bare return and preserves yielded array values', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun first Value',
            '  yield Value',
            '  return',
            '  yield 99',
            'end',
            'Values = (array 1 2) first',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        const yielded = values.plan.iterate().next();
        expect(yielded.done).toBe(false);
        expect(yielded.value).toMatchObject({ kind: 'array', shape: [2] });
    });

    it('rejects return values in generators when execution reaches them', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun invalid N',
            '  yield N',
            '  return N',
            'end',
            'Values = 1 invalid',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        expect(() => formatValue(values)).toThrowError('a generator cannot return a value');
        expect(() => run('fun invalid N\n  return\nend\n1 invalid'))
            .toThrowError('a value-returning function must return a value');
        expect(() => run('yield 1'))
            .toThrowError('yield is only valid inside a generator function');
    });

    it('defers generator errors until the failing element is requested', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun values N',
            '  yield N',
            '  yield 1 // 0',
            'end',
            'Values = 7 values',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        const iterator = values.plan.iterate();
        expect(iterator.next()).toEqual({ value: 7n, done: false });
        expect(() => iterator.next()).toThrowError('division by zero');
    });

    it('closes generator resources when its consumer stops', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'fun positions Path',
            '  File = Path open',
            '  yield File position',
            '  yield File size',
            'end',
            'Values = "/input" positions',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        const iterator = values.plan.iterate();
        expect(iterator.next()).toEqual({ value: 0n, done: false });
        expect(io.handles[0].closed).toBe(false);
        iterator.return?.();
        expect(io.handles[0].closed).toBe(true);
    });

    it('keeps resources owned by an escaping local function', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'fun reader Path',
            '  File = Path open',
            '  return take',
            '',
            '  fun take Count',
            '    return File Count readbytes',
            '  end',
            'end',
            'Take = "/input" reader',
            'Bytes = 2 Take',
        ].join('\n'));

        expect(formatValue(interpreter.variables.get('Bytes')!)).toBe('0x5261');
        expect(io.handles[0].closed).toBe(true);
    });

    it('reads and writes UTF-8 text through the host adapter', () => {
        const io = new MemoryIo({ '/input': 'one\r\ntwo\n' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'Text = "/input" read',
            'Lines = "/input" readlines',
            '"start" "/output" write',
            '" end" "/output" append',
        ].join('\n'));

        expect(interpreter.variables.get('Text')).toBe('one\r\ntwo\n');
        expect(formatValue(interpreter.variables.get('Lines')!)).toBe('one two');
        expect(new TextDecoder().decode(io.files.get('/output'))).toBe('start end');
    });

    it('decodes JSON values with exact integers and keyed objects', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'use json',
            'use sequences',
            'Data = "{\\"huge\\":9007199254740993,\\"real\\":-2.5,\\"text\\":\\"A\\\\uD83D\\\\uDE00\\",\\"flag\\":true,\\"nothing\\":null,\\"items\\":[1,2]}" json',
            'Huge = Data "huge"',
            'Real = Data "real"',
            'Text = Data "text"',
            'Flag = Data "flag"',
            'Nothing = Data "nothing"',
            'Items = Data "items"',
            'RootType = Data type',
            'ItemsType = Items type',
            'NothingType = Nothing type',
            'HasHuge = "huge" in Data',
            'Count = Data len',
            'Keys = Data keys',
            '',
            'fun keys Object',
            '  Result = ""',
            '  for Value Key in Object',
            '    Result += Key',
            '  end',
            '  return Result',
            'end',
        ].join('\n'));

        expect(interpreter.variables.get('Huge')).toBe(9007199254740993n);
        expect(interpreter.variables.get('Real')).toBe(-2.5);
        expect(interpreter.variables.get('Text')).toBe('A😀');
        expect(interpreter.variables.get('Flag')).toBe(true);
        expect(interpreter.variables.get('Nothing')).toEqual({ kind: 'label', name: 'null' });
        expect(interpreter.variables.get('RootType')).toEqual({ kind: 'label', name: 'object' });
        expect(interpreter.variables.get('ItemsType')).toEqual({ kind: 'label', name: 'array' });
        expect(interpreter.variables.get('NothingType')).toEqual({ kind: 'label', name: 'symbol' });
        expect(interpreter.variables.get('HasHuge')).toBe(true);
        expect(interpreter.variables.get('Count')).toBe(6n);
        expect(interpreter.variables.get('Keys'))
            .toBe('hugerealtextflagnothingitems');
    });

    it('reports invalid JSON and rejects non-text input', () => {
        const interpreter = new Interpreter();
        expect(() => interpreter.execute('use json\n"{\\"value\\":]" json'))
            .toThrowError('invalid JSON: expected a JSON value at position 9');
        expect(() => interpreter.execute('use json\n42 json'))
            .toThrowError('json expects text');
    });

    it('reads byte ranges and seeks open files', () => {
        const io = new MemoryIo({ '/input': 'abcdef' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'Direct = "/input" 1 3 readbytes',
            'File = "/input" open',
            'First = File 2 readbytes',
            'File 3 seek',
            'Second = File 3 readbytes',
            'Offset = File position',
            'Length = File size',
            'Done = File eof',
        ].join('\n'));

        expect(formatValue(interpreter.variables.get('Direct')!)).toBe('0x626364');
        expect(formatValue(interpreter.variables.get('First')!)).toBe('0x6162');
        expect(formatValue(interpreter.variables.get('Second')!)).toBe('0x646566');
        expect(interpreter.variables.get('Offset')).toBe(6n);
        expect(interpreter.variables.get('Length')).toBe(6n);
        expect(interpreter.variables.get('Done')).toBe(true);
        expect(io.handles[0].closed).toBe(true);
    });

    it('writes bytes through write, update and append handles', () => {
        const io = new MemoryIo({ '/source': 'abc', '/output': 'old' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'Bytes = "/source" 0 3 readbytes',
            'Output = "/output" .write open',
            'Output Bytes writebytes',
            'Output flush',
            'Patch = "/source" 1 1 readbytes',
            'Update = "/output" .update open',
            'Update 1 seek',
            'Update Patch writebytes',
            'Tail = "/source" 2 1 readbytes',
            'Log = "/output" .append open',
            'Log Tail writebytes',
        ].join('\n'));

        expect(new TextDecoder().decode(io.files.get('/output'))).toBe('abcc');
        expect(io.handles.every(handle => handle.closed)).toBe(true);
    });

    it('supports explicit early close and rejects later file access', () => {
        const io = new MemoryIo({ '/input': 'abc' });
        const interpreter = new Interpreter(undefined, { io });
        expect(() => interpreter.execute([
            'use io',
            'File = "/input" open',
            'File close',
            'File 1 readbytes',
        ].join('\n'))).toThrowError('file is closed: /input');
        expect(io.handles[0].closed).toBe(true);
    });

    it('moves returned files into the caller resource scope', () => {
        const io = new MemoryIo({ '/input': 'abcdef' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'File = "/input" source',
            'File 2 seek',
            'Data = File 2 readbytes',
            '',
            'fun source Path',
            '  File = Path open',
            '  return File',
            'end',
        ].join('\n'));

        expect(formatValue(interpreter.variables.get('Data')!)).toBe('0x6364');
        expect(io.handles[0].closed).toBe(true);
    });

    it('closes owned files when execution raises an error', () => {
        const io = new MemoryIo({ '/input': 'abcdef' });
        const interpreter = new Interpreter(undefined, { io });
        expect(() => interpreter.execute([
            'use io',
            'File = "/input" open',
            '.Broken raise',
        ].join('\n'))).toThrowError('.Broken');
        expect(io.handles[0].closed).toBe(true);
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
