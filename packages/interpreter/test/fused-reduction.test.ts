import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, createArraySnapshot, isNativeFunction, isRankArray, type RankArray, type RankValue } from '../src/index.js';

const vector = (items: RankValue[], shape = [items.length]): RankArray => createArraySnapshot(items, shape);
function call(runtime: Interpreter, name: string, ...args: RankValue[]): RankValue {
    const fn = runtime.variables.get(name)!;
    if (!isNativeFunction(fn)) throw new Error(name);
    return fn.call(args);
}
function force(value: RankValue): unknown {
    return isRankArray(value) ? { shape: value.shape, items: value.items.map(force) } : value;
}

describe('inline arithmetic reduction', () => {
    for (const operator of ['+', '-', '*']) {
        it(`preserves ${operator} reduction order, types and empty behavior`, () => {
            const runtime = new Interpreter();
            runtime.execute(`
fun fused A B
  return (A * 2 + (B - A)) ${operator} reduce
end
fun expression A B
  return A * 2 + (B - A)
end
fun total X
  return X ${operator} reduce
end
`);
            for (const values of [
                [2n ** 100n, 7n, -(2n ** 80n)],
                [2n ** 80n, 1n, 0.25, -3n],
                [1e16, 1, -1e16, 0.25],
                [-0], [Infinity, -Infinity, NaN], [],
            ]) {
                const a = vector(values);
                const b = vector([...values].reverse());
                if (values.length === 0 && operator === '-') {
                    expect(() => call(runtime, 'fused', a, b)).toThrow('empty cell');
                } else {
                    expect(force(call(runtime, 'fused', a, b)))
                        .toEqual(force(call(runtime, 'total', call(runtime, 'expression', a, b))));
                }
            }
            expect(call(runtime, 'fused', 3n, 4n)).toEqual(call(runtime, 'total', call(runtime, 'expression', 3n, 4n)));
            runtime.dispose();
        });
    }

    it('keeps broadcast and nested-value fallback', () => {
        const runtime = new Interpreter();
        runtime.execute(`
fun fused A B
  return (A * 2 + B) + reduce
end
fun expression A B
  return A * 2 + B
end
fun total X
  return X + reduce
end
`);
        for (const [a, b] of [
            [vector([1n, 2n], [2, 1]), vector([10n, 20n, 30n], [1, 3])],
            [vector([vector([1n, 2n]), vector([3n, 4n])]), 1n],
        ] as [RankValue, RankValue][]) {
            expect(force(call(runtime, 'fused', a, b)))
                .toEqual(force(call(runtime, 'total', call(runtime, 'expression', a, b))));
        }
        runtime.dispose();
    });

    it('retains lazy read order and stops without replay on failure', () => {
        const runtime = new Interpreter();
        runtime.execute('fun fused A B\n  return (A * 2 + B) + reduce\nend');
        const reads: string[] = [];
        const lazy = (name: string): RankArray => ({
            kind: 'array', shape: [3], containsFiles: false,
            itemAt: index => {
                reads.push(`${name}${index}`);
                if (index === 1 && name === 'b') return 'bad';
                if (index === 2) throw new Error('read too far');
                return 1n;
            },
            get items(): RankValue[] { throw new Error('forced input'); },
        });
        expect(() => call(runtime, 'fused', lazy('a'), lazy('b'))).toThrow('+ expects');
        expect(reads).toEqual(['a0', 'b0', 'a1', 'b1']);
        runtime.dispose();
    });

    it('reads lazy operands in tree order and observes mutations between calls', () => {
        const runtime = new Interpreter();
        runtime.execute('fun fused A B\n  return (A + (B * 2)) + reduce\nend');
        const reads: string[] = [];
        const a: RankArray = { ...vector([1n, 2n]), itemAt: index => {
            if (index === 0) { reads.push('a0'); b.items[0] = 10n; }
            return a.items[index];
        } };
        const b: RankArray = { ...vector([3n, 4n]), itemAt: index => {
            if (index === 1) reads.push('b1');
            return b.items[index];
        } };
        expect(call(runtime, 'fused', a, b)).toBe(31n);
        expect(reads).toEqual(['a0', 'b1']);
        a.items[1] = 20n;
        expect(call(runtime, 'fused', a, b)).toBe(49n);
        runtime.dispose();
    });

    it('preserves cached named intermediates and explicit rank reductions', () => {
        const runtime = new Interpreter();
        runtime.execute('fun fused A B\n  return (A * 2 + B) + reduce\nend');
        const a = vector([1n, 2n]);
        runtime.variables.set('A', a);
        runtime.execute('Temp = A + A');
        const temp = runtime.variables.get('Temp') as RankArray;
        expect(temp.itemAt!(0)).toBe(2n);
        a.items[0] = 10n;
        a.items[1] = 20n;
        expect(call(runtime, 'fused', temp, 0n)).toBe(120n);
        runtime.variables.set('M', vector([1n, 2n, 3n, 4n], [2, 2]));
        expect(force(runtime.execute('(M * 2 + M) + reduce rank 1')!))
            .toEqual({ shape: [2], items: [9n, 21n] });
        runtime.dispose();
    });

    it('keeps setup errors before later name reads and retains Rank positions', () => {
        const runtime = new Interpreter();
        runtime.variables.set('A', vector([1n, 2n]));
        runtime.variables.set('B', vector([1n, 2n, 3n]));
        expect(() => runtime.execute('(A + B + Missing) + reduce')).toThrow('shape mismatch');
        runtime.variables.set('Flag', true);
        expect(() => runtime.execute('(Flag * 2 + Missing) + reduce')).toThrow('expected number, got boolean');
        runtime.execute('fun fused A B\n  return (A * 2 + B) + reduce\nend');
        try {
            call(runtime, 'fused', vector([1n, 'bad']), 0n);
            throw new Error('expected failure');
        } catch (error) {
            expect(error).toBeInstanceOf(RankError);
            expect((error as RankError).location).toMatchObject({ line: 2, column: 3 });
        }
        runtime.dispose();
    });

    it('leaves effectful calls and nested modifiers on the ordinary path', () => {
        const runtime = new Interpreter();
        runtime.execute(`
fun change A
  A 1 = 10
  return A
end
fun fused A
  return (A + (A change)) + reduce
end
`);
        // change returns its own array, so the left operand still reads 1 2 and
        // the result no longer depends on which side is evaluated first.
        expect(call(runtime, 'fused', vector([1n, 2n]))).toBe(14n);
        runtime.variables.set('A', vector([1n, 2n]));
        expect(runtime.execute('((A + scan) * 2) + reduce')).toBe(8n);
        runtime.dispose();
    });
});
