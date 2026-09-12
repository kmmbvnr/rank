import { describe, expect, it } from 'vitest';
import { FlatRecords } from '../src/flat.js';
import { RankSegment } from '../src/segment.js';
import type { RankRecord, RankValue } from '../src/value.js';
import { run } from './support.js';

const record = (n: bigint): RankRecord => ({ kind: 'record', entries: new Map([['n', n]]), types: new Map([['n', 'integer']]) });
const setup = `use algo
use sequences
Zero = record
  .n = 0
end
fun combine A B
  return record
    .n = A .n + B .n
  end
end
`;

describe('flat records and user monoids', () => {
    it('constructs, reads and updates compact records by value', () => {
        expect(run(setup + `Values = 3 Zero flat
Values 0 .n = 4
Saved = Values 0
Saved .n = 90
Values 1 = Saved
Copy = Values copy
Copy 0 .n += 2
array (Values 0 .n) (Values 1 .n) (Copy 0 .n)`)).toBe('4 90 6');
    });

    it('builds custom record trees with an identity and isolated leaf reads', () => {
        expect(run(setup + `Values = 3 Zero flat
Values 0 .n = 2
Values 1 .n = 3
Tree = Values with Zero with combine segment
Before = Tree 0 2 query
Leaf = Tree 0
Leaf .n = 100
Tree 1 = Leaf
After = Tree 0 2 query
Empty = Tree 1 0 query
array (Before .n) (After .n) (Empty .n) (Values 1 .n)`)).toBe('5 102 0 3');
    });

    it('supports ordinary records, conversion and empty monoids', () => {
        expect(run(setup + `Values = (array Zero Zero) flat
Tree = Values combine segment
Empty = (0 Zero flat) with Zero with combine segment
Plain = (array Zero Zero) with Zero with combine segment
array ((Tree 0 1 query) .n) ((Empty 0 (-1) query) .n) ((Plain 0 1 query) .n)`)).toBe('0 0 0');
    });

    it('keeps noncommutative order and scalar neutral elements', () => {
        expect(run(`use algo
fun merge A B
  return A + B
end
Tree = (array "a" "b" "c") with "" with merge segment
array (Tree 0 2 query) (Tree 2 1 query)`)).toBe('abc ');
    });

    it('stores mixed fields in one fixed-width payload and rejects lossy writes', () => {
        const state: RankRecord = { kind: 'record', entries: new Map<string, RankValue>([
            ['n', -(1n << 63n)], ['r', -0], ['b', true],
        ]), types: new Map([['n', 'integer'], ['r', 'real'], ['b', 'boolean']]) };
        const values = new FlatRecords(1000, state);
        expect(values.byteLength).toBe(24000);
        expect(values.itemAt(0)).toEqual(state);
        expect(Object.is(values.itemAt(0).entries.get('r'), -0)).toBe(true);
        const invalid = values.itemAt(0);
        invalid.entries.set('n', 1n << 63n);
        expect(() => values.set(0, invalid)).toThrow('signed 64-bit');
        expect(values.itemAt(0)).toEqual(state);
        invalid.entries.set('n', 'wrong');
        expect(() => values.set(0, invalid)).toThrow('expects integer');
    });

    it('keeps tree payload compact and failed updates atomic', () => {
        const values = new FlatRecords(2, record(1n));
        const combine = (a: RankValue, b: RankValue) => record(
            ((a as RankRecord).entries.get('n') as bigint) + ((b as RankRecord).entries.get('n') as bigint));
        const tree = new RankSegment(values, combine, 'combine', undefined, record(0n));
        expect(tree.storageBytes).toBe(36);
        expect(() => tree.set(0n, record((1n << 63n) - 1n))).toThrow('signed 64-bit');
        expect(tree.at(0n)).toEqual(record(1n));
        expect(tree.query(0n, 1n)).toEqual(record(2n));
        tree.set(0n, record(5n));
        expect(tree.query(0n, 1n)).toEqual(record(6n));
    });
    it('continues a monoid pipeline and preserves the flat identity by value', () => {
        expect(run(setup + `Values = 0 Zero flat
Tree = Values with Zero with combine segment
Zero .n = 10
First = Tree 0 (-1) query
First .n = 20
array ((Tree 0 (-1) query) .n) ((Values with First with combine segment 0 (-1) query) .n)`)).toBe('0 20');
    });

    it('rejects invalid schemas, bounds and writes through tree leaf snapshots', () => {
        expect(() => run(setup + 'Values = 1 Zero flat\nValues 1 .n = 2')).toThrow('out of bounds');
        expect(() => run(setup + 'Values = 1 Zero flat\nTree = Values combine segment\nTree 0 .n = 2'))
            .toThrow('segment assignment expects one integer index');
        expect(() => run(setup + 'Values = 0 Zero flat\nTree = Values with Zero with combine segment\nTree 1 0 query'))
            .toThrow('out of bounds');
        const invalid = record(0n);
        invalid.entries.set('extra', true);
        const values = new FlatRecords(1, record(0n));
        expect(() => values.set(0, invalid)).toThrow('same fields');
        expect(() => new FlatRecords(1, { kind: 'record', entries: new Map([['s', 'text']]), types: new Map() }))
            .toThrow('integer, real or boolean');
    });

    it('matches ordered affine composition across arbitrary ranges and updates', () => {
        const affine = (a: bigint, b: bigint): RankRecord => ({ kind: 'record',
            entries: new Map([['a', a], ['b', b]]), types: new Map([['a', 'integer'], ['b', 'integer']]) });
        const combine = (left: RankValue, right: RankValue): RankRecord => {
            const l = (left as RankRecord).entries, r = (right as RankRecord).entries;
            return affine((r.get('a') as bigint) * (l.get('a') as bigint) % 1009n,
                ((r.get('a') as bigint) * (l.get('b') as bigint) + (r.get('b') as bigint)) % 1009n);
        };
        const identity = affine(1n, 0n);
        const input = Array.from({ length: 19 }, (_, i) => affine(BigInt(i + 1), BigInt(i)));
        const packed = new FlatRecords(input.length, identity);
        input.forEach((value, i) => packed.set(i, value));
        const tree = new RankSegment(packed, combine, 'compose', undefined, identity);
        for (let step = 0; step < 100; step++) {
            const index = step * 7 % input.length;
            input[index] = affine(BigInt(step % 11), BigInt(step));
            tree.set(BigInt(index), input[index]);
            for (let left = 0; left < input.length; left++) {
                const right = Math.min(input.length - 1, left + step % 13);
                const expected = input.slice(left, right + 1).reduce(combine, identity);
                expect(tree.query(BigInt(left), BigInt(right))).toEqual(expected);
            }
        }
    });

});
