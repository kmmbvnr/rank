import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, createArraySnapshot, isNativeFunction, type RankArray, type RankValue } from '../src/index.js';

const vector = (items: RankValue[], shape = [items.length]): RankArray => ({ kind: 'array', items, shape, containsFiles: false });
const call = (runtime: Interpreter, name: string, ...args: RankValue[]) => {
    const fn = runtime.variables.get(name);
    if (!fn || !isNativeFunction(fn)) throw new Error(name);
    return fn.call(args);
};
const source = `use numbers
fun fused A B
  return (A * B) sum
end
fun ordinary A B
  Temp = A * B
  return Temp sum
end
fun addsum A B
  return (A + B) sum
end
fun replacement A
  return 99
end`;

describe('builtin sum semantics required by fusion', () => {
    it('uses the fused consumer only while snapshot storage remains private', () => {
        const runtime = new Interpreter();
        runtime.execute(source);
        const input = createArraySnapshot([1n, 2n]);
        const apply = vi.spyOn(runtime as unknown as {
            invoke(fn: { name: string }, args: RankValue[]): unknown;
        }, 'invoke');
        expect(call(runtime, 'fused', input, 2n)).toBe(6n);
        expect(apply.mock.calls.filter(([fn]) => fn.name === 'sum')).toHaveLength(0);
        expect(call(runtime, 'ordinary', input, 2n)).toBe(6n);
        expect(apply.mock.calls.filter(([fn]) => fn.name === 'sum')).toHaveLength(1);
        runtime.dispose();
    });
    it('does not introduce descriptor probes on host proxies', () => {
        const runtime = new Interpreter();
        runtime.execute(source);
        let probes = 0;
        const input = () => new Proxy(vector([1n]), {
            getOwnPropertyDescriptor(target, key) {
                if (key === 'items') { probes++; target.items[0] = 100n; }
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        expect(call(runtime, 'ordinary', input(), 2n)).toBe(2n);
        expect(call(runtime, 'fused', input(), 2n)).toBe(2n);
        expect(probes).toBe(0);
        runtime.dispose();
    });
    it('matches ordinary sum types, seed and floating-point order', () => {
        const runtime = new Interpreter();
        runtime.execute(source);
        for (const items of [[], [-0], [Infinity, -Infinity], [NaN], [1e16, 1, -1e16],
            [2n ** 100n, 1n, -(2n ** 100n)], [1n, 0.25, 3n]]) {
            for (const make of [vector, createArraySnapshot]) {
                const a = make(items), b = make(items.map(() => 1n));
                expect(call(runtime, 'fused', a, b)).toEqual(call(runtime, 'ordinary', a, b));
            }
        }
        expect(call(runtime, 'fused', 3n, 4n)).toBe(12n);
        expect(call(runtime, 'fused', vector([1n, 2n], [2, 1]), vector([3n, 4n], [1, 2]))).toBe(21n);
        runtime.dispose();
    });

    it('resolves a shadowed sum after its operands and does not consume its input', () => {
        const runtime = new Interpreter();
        runtime.execute(source);
        runtime.variables.set('sum', runtime.variables.get('replacement')!);
        const items: RankValue[] = [1n];
        Object.defineProperty(items, '0', { get: () => { throw new Error('read input'); } });
        expect(call(runtime, 'fused', vector(items), 2n)).toBe(99n);
        runtime.variables.set('A', vector([1n, 2n]));
        runtime.variables.set('B', vector([1n, 2n, 3n]));
        expect(() => runtime.execute('(A * B + Missing) sum')).toThrow('shape mismatch');
        runtime.dispose();
    });

    it('finishes arithmetic reads before reporting a bad summand', () => {
        const runtime = new Interpreter();
        runtime.execute(source);
        const reads: number[] = [];
        const nested = vector([1n]);
        const items: RankValue[] = [nested, 2n, 3n];
        for (let index = 0; index < 3; index++) Object.defineProperty(items, index, {
            get: () => { reads.push(index); return index === 0 ? nested : BigInt(index); },
        });
        expect(() => call(runtime, 'fused', vector(items), 2n)).toThrow('expected numeric input');
        expect(reads).toEqual([0, 1, 2]);
        Object.defineProperty(items, '2', { get: () => { throw new Error('late read'); } });
        expect(() => call(runtime, 'fused', vector(items), 2n)).toThrow('late read');
        runtime.dispose();
    });

    it('keeps getter order and the already resolved consumer when a read rebinds sum', () => {
        const runtime = new Interpreter();
        runtime.execute(source);
        const reads: string[] = [];
        const a = vector([1n, 2n]), b = vector([3n, 4n]);
        Object.defineProperty(a.items, '0', { get: () => {
            reads.push('a0');
            b.items[0] = 10n;
            runtime.variables.set('sum', runtime.variables.get('replacement')!);
            return 1n;
        } });
        Object.defineProperty(b.items, '1', { get: () => { reads.push('b1'); return 4n; } });
        expect(call(runtime, 'fused', a, b)).toBe(18n);
        expect(reads).toEqual(['a0', 'b1']);
        expect(call(runtime, 'fused', a, b)).toBe(99n);
        expect(reads).toEqual(['a0', 'b1']);
        runtime.dispose();
    });

    it('retains lazy and repeated named caches, mutations and source positions', () => {
        const runtime = new Interpreter();
        runtime.execute(source);
        const a = vector([1n, 2n]);
        runtime.variables.set('A', a);
        runtime.execute('Temp = A + A');
        const temp = runtime.variables.get('Temp') as RankArray;
        expect(temp.itemAt!(0)).toBe(2n);
        a.items[0] = 10n;
        a.items[1] = 20n;
        expect(call(runtime, 'fused', temp, 2n)).toBe(84n);
        expect(call(runtime, 'fused', temp, 2n)).toBe(84n);
        try { call(runtime, 'fused', vector([true]), 2n); }
        catch (error) {
            expect(error).toBeInstanceOf(RankError);
            expect((error as RankError).location).toMatchObject({ line: 3, column: 3 });
            runtime.dispose();
            return;
        }
        throw new Error('expected Rank error');
    });
});
