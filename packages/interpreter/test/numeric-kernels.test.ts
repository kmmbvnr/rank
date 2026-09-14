import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, isNativeFunction, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { numericKernel } from '../src/numeric-kernels.js';
import { mapBroadcastArrays } from '../src/tensor.js';

const vector = (items: RankValue[], shape = [items.length]): RankArray => ({ kind: 'array', items, shape });

function call(runtime: Interpreter, name: string, ...args: RankValue[]): RankValue {
    const fn = runtime.variables.get(name)!;
    if (!isNativeFunction(fn)) throw new Error(`missing function ${name}`);
    return fn.call(args);
}

function items(value: RankValue): RankValue[] {
    if (!isRankArray(value)) throw new Error('expected array');
    return value.items;
}

describe('numeric collection kernels', () => {
    it('guards integer power and leaves real domains to the scalar fallback', () => {
        const calls: RankValue[][] = [];
        const power = numericKernel('**', (left, right) => {
            calls.push([left, right]);
            return 'fallback';
        });
        expect(power(2n ** 70n, 3n)).toBe(2n ** 210n);
        expect(power(0n, 0n)).toBe(1n);
        expect(power(0n, -1n)).toBe('fallback');
        expect(power(-2, 0.5)).toBe('fallback');
        expect(power('bad', 2n)).toBe('fallback');
        expect(calls).toEqual([[0n, -1n], [-2, 0.5], ['bad', 2n]]);
    });

    it('keeps sequence arithmetic lazy, exact and repeatable', () => {
        const runtime = new Interpreter();
        expect(runtime.execute(`use numbers
R = 1 to 4
Squares = R ** 2
A = Squares sum
B = Squares sum
A + B`)).toBe(60n);
        expect(runtime.execute('use numbers\n((1 to 3) + (4 to 6)) sum')).toBe(21n);
        expect(runtime.execute('use numbers\n(10 - (1 to 3)) sum')).toBe(24n);
        expect(runtime.execute('use numbers\n((1 to 3) * 0.5) sum')).toBe(3);
        expect(runtime.execute('use numbers\n((1 until 1) ** (-1)) sum')).toBe(0n);
        expect(() => runtime.execute('use numbers\n((0 to 1) ** (-1)) sum'))
            .toThrow('zero cannot be raised to a negative power');
        expect(() => runtime.execute('use numbers\n((-2 to -1) ** 0.5) sum'))
            .toThrow('power result is not real');
        runtime.dispose();
    }, 15_000);

    for (const operator of ['+', '-', '*']) {
        it(`matches scalar ${operator} for mixed numbers and floating-point edge cases`, () => {
            const runtime = new Interpreter();
            runtime.execute(`
fun binary A B
  return A ${operator} B
end
fun total A
  return A ${operator} reduce
end
fun prefix A
  return A ${operator} scan
end
`);
            for (const values of [
                [2n ** 100n, 7n, -(2n ** 80n)],
                [2n ** 80n, 1n, 0.25, -3n, 2],
                [1e16, 1, -1e16, 0.25],
                [-0, -0, 0, -0],
                [Infinity, -Infinity, NaN, 1],
            ]) {
                let accumulated = values[0];
                const prefix: RankValue[] = [accumulated];
                for (let index = 1; index < values.length; index += 1) {
                    accumulated = call(runtime, 'binary', accumulated, values[index]) as number | bigint;
                    prefix.push(accumulated);
                }
                expect(call(runtime, 'total', vector(values))).toEqual(accumulated);
                expect(items(call(runtime, 'prefix', vector(values)))).toEqual(prefix);
                expect(items(call(runtime, 'binary', vector(values), vector([...values].reverse()))))
                    .toEqual(values.map((value, index) => call(runtime, 'binary', value, values[values.length - index - 1])));
                expect(items(call(runtime, 'binary', vector(values), 2n)))
                    .toEqual(values.map(value => call(runtime, 'binary', value, 2n)));
                expect(items(call(runtime, 'binary', 2n, vector(values))))
                    .toEqual(values.map(value => call(runtime, 'binary', 2n, value)));
            }
            runtime.dispose();
        });
    }

    it('uses fallback only for unsupported pairs and operators', () => {
        const calls: RankValue[][] = [];
        const fallback = (a: RankValue, b: RankValue) => { calls.push([a, b]); return 'fallback'; };
        const add = numericKernel('+', fallback);
        expect(add(1n, 2n)).toBe(3n);
        expect(add(1n, 0.5)).toBe(1.5);
        expect(add('a', 'b')).toBe('fallback');
        expect(add(true, 2n)).toBe('fallback');
        expect(numericKernel('%', fallback)).toBe(fallback);
        expect(calls).toEqual([['a', 'b'], [true, 2n]]);
    });

    it('retains empty identities, singleton values and nonnumeric fallback', () => {
        const runtime = new Interpreter();
        runtime.variables.set('Empty', vector([]));
        expect(runtime.execute('Empty + reduce')).toBe(0n);
        expect(runtime.execute('Empty * reduce')).toBe(1n);
        expect(() => runtime.execute('Empty - reduce')).toThrow('empty cell');
        expect(items(runtime.execute('Empty + scan')!)).toEqual([]);
        expect(runtime.execute('(array "a" "b" "c") + reduce')).toBe('abc');
        expect(items(runtime.execute('(array "a" "b" "c") + scan')!)).toEqual(['a', 'ab', 'abc']);
        expect(runtime.execute('(array true false) and reduce')).toBe(false);
        runtime.variables.set('Single', vector([-0]));
        expect(runtime.execute('Single + reduce')).toBe(-0);
        expect(runtime.execute('use numbers\nSingle sum')).toBe(0);
        expect(() => runtime.execute('(array 1 "a") + reduce')).toThrow('+ expects two numeric or two text values');
        expect(() => runtime.execute('(array 1 0) / reduce')).toThrow('division by zero');
        runtime.dispose();
    });

    it('reduces tensor cells by rank and keeps zero-sized frames', () => {
        const runtime = new Interpreter();
        runtime.variables.set('A', vector([1n, 2n, 3n, 4n, 5n, 6n], [2, 3]));
        expect(items(runtime.execute('A + reduce rank 1')!)).toEqual([6n, 15n]);
        expect(items(runtime.execute('A + reduce rank 0')!)).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
        runtime.variables.set('Empty', vector([], [2, 0]));
        expect(items(runtime.execute('Empty + reduce rank 1')!)).toEqual([0n, 0n]);
        runtime.dispose();
    });

    it('sums contiguous and strided axes with the builtin seed and honors shadowing', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers');
        runtime.variables.set('A', vector([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n], [2, 2, 2]));
        expect(items(runtime.execute('A sum axis 0 2')!)).toEqual([14n, 22n]);
        expect(items(runtime.execute('A sum axis 2 0')!)).toEqual([14n, 22n]);
        expect(items(runtime.execute('A sum axis 1')!)).toEqual([4n, 6n, 12n, 14n]);
        expect(runtime.execute('A sum axis 0 1 2')).toBe(36n);
        runtime.variables.set('Zeros', vector([-0, -0], [2, 1]));
        expect(items(runtime.execute('Zeros sum axis 1')!)).toEqual([0, 0]);
        runtime.variables.set('Empty', vector([], [2, 0]));
        expect(items(runtime.execute('Empty sum axis 1')!)).toEqual([0n, 0n]);
        runtime.execute('fun custom A\n  return 99\nend');
        runtime.variables.set('sum', runtime.variables.get('custom')!);
        expect(items(runtime.execute('A sum axis 1')!)).toEqual([99n, 99n, 99n, 99n]);
        runtime.dispose();
    });

    it('preserves lazy operand order and partial access for untracked host readers', () => {
        const reads: string[] = [];
        const source = (name: string): RankArray => ({
            kind: 'array', shape: [3], containsFiles: false,
            itemAt: index => { reads.push(`${name}${index}`); return BigInt(index); },
            get items(): RankValue[] { throw new Error('must not materialize input'); },
        });
        const result = mapBroadcastArrays(source('a'), source('b'), numericKernel('+', () => { throw new Error('fallback'); }));
        expect(reads).toEqual([]);
        expect(result.itemAt!(1)).toBe(2n);
        expect(result.itemAt!(1)).toBe(2n);
        expect(reads).toEqual(['a1', 'b1', 'a1', 'b1']);
        expect(result.items).toEqual([0n, 2n, 4n]);
        expect(reads).toEqual(['a1', 'b1', 'a1', 'b1', 'a0', 'b0', 'a1', 'b1', 'a2', 'b2']);
    });

    it('keeps general broadcasting and shape errors', () => {
        const add = numericKernel('+', () => { throw new Error('fallback'); });
        const result = mapBroadcastArrays(vector([1n, 2n], [2, 1]), vector([10n, 20n, 30n], [1, 3]), add);
        expect(result.shape).toEqual([2, 3]);
        expect(result.items).toEqual([11n, 21n, 31n, 12n, 22n, 32n]);
        expect(mapBroadcastArrays(vector([], [0, 3]), vector([1n], [1, 1]), add).items).toEqual([]);
        expect(() => mapBroadcastArrays(vector([1n, 2n]), vector([1n, 2n, 3n]), add)).toThrow('shape mismatch');
    });

    it('does not pre-read lazy inputs or replay a mixed-type failure', () => {
        const runtime = new Interpreter();
        runtime.execute('fun total A\n  return A + reduce\nend\nfun prefix A\n  return A + scan\nend');
        const reads: number[] = [];
        const input: RankArray = {
            kind: 'array', shape: [3], containsFiles: false,
            itemAt: index => {
                reads.push(index);
                if (index === 2) throw new Error('read too far');
                return index === 0 ? 1n : 'bad';
            },
            get items(): RankValue[] { throw new Error('materialized input'); },
        };
        for (const name of ['total', 'prefix']) {
            reads.length = 0;
            expect(() => call(runtime, name, input)).toThrow('+ expects two numeric or two text values');
            expect(reads).toEqual([0, 1]);
        }
        runtime.dispose();
    });

    it('retains read-before-validation order for lazy axis sum cells', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nfun rows A\n  return A sum axis 1\nend');
        const reads: number[] = [];
        const input: RankArray = {
            kind: 'array', shape: [1, 3], containsFiles: false,
            itemAt: index => {
                reads.push(index);
                if (index === 2) throw new Error('last cell read');
                return index === 0 ? 1n : 'bad';
            },
            get items(): RankValue[] { throw new Error('materialized input'); },
        };
        expect(() => items(call(runtime, 'rows', input))).toThrow('last cell read');
        expect(reads).toEqual([0, 1, 2]);
        runtime.dispose();
    });

    it('reads mutations for both consumed and unconsumed host pairs', () => {
        const source = vector([1n, 2n]);
        const result = mapBroadcastArrays(source, source, numericKernel('+', () => 'fallback'));
        expect(result.itemAt!(0)).toBe(2n);
        source.items[0] = 10n;
        source.items[1] = 20n;
        expect(result.items).toEqual([20n, 40n]);
    });

    it('retains nested-array fallback and Rank error positions', () => {
        const runtime = new Interpreter();
        runtime.execute('fun total A\n  return A + reduce\nend');
        expect(items(call(runtime, 'total', vector([vector([1n, 2n]), vector([3n, 4n])]))))
            .toEqual([4n, 6n]);
        try {
            call(runtime, 'total', vector([1n, 'bad']));
            throw new Error('expected failure');
        } catch (error) {
            expect(error).toBeInstanceOf(RankError);
            expect((error as RankError).location).toMatchObject({ line: 2, column: 3 });
        }
        runtime.dispose();
    });
});
