import { describe, expect, it, vi } from 'vitest';
import { Interpreter } from '../src/index.js';
import { FlatRecords } from '../src/flat.js';
import { flatCombine } from '../src/flat-combine.js';
import { RankSegment } from '../src/segment.js';
import type { NativeFunction, RankRecord, RankValue } from '../src/value.js';

const state = (n: bigint): RankRecord => ({ kind: 'record', entries: new Map([['n', n]]), types: new Map([['n', 'integer']]) });
const sum = `fun combine A B
  return record
    .n = A .n + B .n
  end
end`;
function fixture(source = sum, compiled = true) {
    const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: compiled });
    runtime.execute('use algo\nuse sequences\nuse numbers\n' + source);
    const operation = runtime.variables.get('combine') as NativeFunction;
    const values = new FlatRecords(7, state(1n));
    const tree = new RankSegment(values, (a, b) => operation.call([a, b]), 'combine', operation, state(0n));
    return { runtime, operation, values, tree };
}

describe('compiled flat combine', () => {
    it('avoids materializing records at internal nodes', () => {
        const { tree, operation, values } = fixture();
        expect(flatCombine(operation, values)).toBeDefined();
        const read = vi.spyOn(FlatRecords.prototype, 'itemAt');
        try {
            expect(tree.query(1n, 5n)).toEqual(state(5n));
            tree.set(2n, state(4n));
            expect(tree.query(0n, 6n)).toEqual(state(10n));
            expect(read).not.toHaveBeenCalled();
        } finally { read.mockRestore(); }
    });

    it('preserves int64 storage limits, atomic updates and wide query intermediates', () => {
        const { operation, tree } = fixture();
        expect(() => tree.set(0n, state((1n << 63n) - 1n))).toThrow('signed 64-bit');
        expect(tree.query(0n, 6n)).toEqual(state(7n));
        tree.set(0n, state(5n));
        expect(tree.query(0n, 6n)).toEqual(state(11n));
        const max = (1n << 63n) - 1n;
        const values = new FlatRecords(4, state(0n));
        [-max, max, max, -max].forEach((n, i) => values.set(i, state(n)));
        const wide = new RankSegment(values, (a, b) => operation.call([a, b]), 'combine', operation);
        expect(wide.query(1n, 2n)).toEqual(state(max * 2n));
    });

    it('matches the ordinary path for noncommutative functions and reordered output fields', () => {
        const source = `fun combine A B
  return record
    .b = B .a * A .b + B .b
    .a = B .a * A .a
  end
end`;
        const operation = (compiled: boolean) => {
            const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: compiled });
            runtime.execute(source);
            return runtime.variables.get('combine') as NativeFunction;
        };
        const fast = operation(true), slow = operation(false);
        const affine = (a: bigint, b: bigint): RankRecord => ({ kind: 'record',
            entries: new Map([['a', a], ['b', b]]), types: new Map([['a', 'integer'], ['b', 'integer']]) });
        const values = new FlatRecords(19, affine(1n, 1n));
        const build = (fn: NativeFunction) => new RankSegment(values, (a, b) => fn.call([a, b]), 'combine', fn);
        const a = build(fast), b = build(slow);
        expect(flatCombine(fast, values)).toBeDefined();
        for (let step = 0; step < 12; step++) {
            const value = affine(BigInt(step % 2), BigInt(step));
            a.set(BigInt(step), value); b.set(BigInt(step), value);
            for (let left = 0; left < 19; left++) for (let right = left; right < 19; right++) {
                const actual = a.query(BigInt(left), BigInt(right)) as RankRecord;
                const expected = b.query(BigInt(left), BigInt(right)) as RankRecord;
                expect([...actual.entries]).toEqual([...expected.entries]);
                expect([...actual.types]).toEqual([...expected.types]);
            }
        }
    });

    it('rechecks a builtin after global shadowing', () => {
        const source = `fun combine A B
  return record
    .n = (A .n) max (B .n)
  end
end`;
        const fast = fixture(source), slow = fixture(source, false);
        expect(flatCombine(fast.operation, fast.values)).toBeDefined();
        for (const { runtime, tree } of [fast, slow]) {
            runtime.execute('fun max A B\n  return A + B\nend');
            tree.set(0n, state(9n));
        }
        expect(fast.tree.query(1n, 5n)).toEqual(slow.tree.query(1n, 5n));
        expect(fast.tree.query(0n, 6n)).toEqual(slow.tree.query(0n, 6n));
    });

    it('retains ordinary execution for captures, side effects and mixed fields', () => {
        for (const source of [
            'Extra = 2\nfun combine A B\n return record\n .n = A .n + B .n + Extra\n end\nend',
            'Calls = 0\nfun combine A B\n Calls += 1\n return record\n .n = A .n + B .n\n end\nend',
            'fun combine A B\n return record\n .n = (A .n + B .n) % 17\n end\nend',
        ]) {
            const { operation, values } = fixture(source);
            expect(flatCombine(operation, values)).toBeUndefined();
        }
        const { operation } = fixture();
        const real: RankRecord = { kind: 'record', entries: new Map<string, RankValue>([['n', 1.0]]), types: new Map([['n', 'real']]) };
        expect(flatCombine(operation, new FlatRecords(1, real))).toBeUndefined();
    });

    it('proves builtin bindings separately for each closure instance', () => {
        const runtime = new Interpreter();
        runtime.execute(`use numbers
fun make max
  fun combine A B
    return record
      .n = (A .n) max (B .n)
    end
  end
  return combine
end
fun custom A B
  return A + B
end`);
        const make = runtime.variables.get('make') as NativeFunction;
        const builtin = runtime.execute('max')!;
        const custom = runtime.variables.get('custom')!;
        const values = new FlatRecords(3, state(1n));
        const fast = make.call([builtin]) as NativeFunction;
        const slow = make.call([custom]) as NativeFunction;
        expect(flatCombine(fast, values)).toBeDefined();
        expect(flatCombine(slow, values)).toBeUndefined();
        const build = (fn: NativeFunction) => new RankSegment(values, (a, b) => fn.call([a, b]), 'combine', fn);
        expect((build(fast).query(0n, 2n) as RankRecord).entries.get('n')).toBe(1n);
        expect((build(slow).query(0n, 2n) as RankRecord).entries.get('n')).toBe(3n);
    });

    it('falls back when dynamic code generation is blocked', () => {
        const { operation, values } = fixture();
        vi.stubGlobal('Function', function () { throw new Error('CSP'); });
        try { expect(flatCombine(operation, values)).toBeUndefined(); }
        finally { vi.unstubAllGlobals(); }
    });

    it('does not bypass the call-depth limit for an existing tree', () => {
        for (const enabled of [true, false]) {
            const runtime = new Interpreter(() => {}, { maxCallDepth: 1, scalarFunctionCompilation: enabled });
            runtime.execute('use algo\nuse sequences\n' + sum + `
State = record
 .n = 1
end
Tree = (7 State flat) combine segment
fun readtree X
 return Tree 1 5 query
end`);
            expect(() => runtime.execute('0 readtree')).toThrow('function call depth exceeds 1');
        }
    });

    it('preserves nonzero, negative-zero and empty-schema repeated initialization', () => {
        const record: RankRecord = { kind: 'record', entries: new Map<string, RankValue>([['n', -7n], ['r', -0], ['b', true]]),
            types: new Map([['n', 'integer'], ['r', 'real'], ['b', 'boolean']]) };
        for (const size of [0, 1, 3, 129]) {
            const values = new FlatRecords(size, record);
            for (let i = 0; i < size; i++) expect(values.itemAt(i)).toEqual(record);
            expect(values.copy().items).toEqual(values.items);
        }
        const empty: RankRecord = { kind: 'record', entries: new Map(), types: new Map() };
        expect(new FlatRecords(3, empty).items).toEqual([empty, empty, empty]);
    });
});
