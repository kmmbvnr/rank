import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { arrayRevision, noteArrayBinding, ownedArray, readArrayItem } from '../src/array-storage.js';
import { concatValues } from '../src/modules/sequences.js';
import { ArrayBindingContract } from '../src/array-binding-contract.js';
import { sequence } from '../src/sequence.js';
import { prepareIntegerView } from '../src/integer-view.js';
import { isRankSequence, type RankArray } from '../src/value.js';

for (const compilation of [false, true]) describe(`deep concat (compiled=${compilation})`, () => {
    function run(source: string): string {
        const runtime = new Interpreter(() => {}, { compilation });
        try { return formatValue(runtime.execute('use sequences\n' + source)!); }
        finally { runtime.dispose(); }
    }

    it.each([1000, 10000])('appends %i distinct cells through a binding and reads every value', n => {
        expect(run(`A = array shape 0 fill 0\nfor I in 0 till ${n}\n A = concat A (array I)\nend
Total = 0
for X in A
 Total += X
end
array (A len) (A 0) (A ${n - 1}) Total`)).toBe(`${n} 0 ${n - 1} ${n * (n - 1) / 2}`);
    }, 30000);

    it('preserves aliases, copying, and writes to an intermediate result', () => {
        expect(run(`Source = array 1 2
A = concat Source (array 3)
Saved = A
for I in 4 till 2000
 A = concat A (array I)
end
Source 0 = 9
Saved = Saved copy
Saved 1 = 8
Copy = A copy
Copy 0 = 7
array (A 0) (A 1) (Saved 1) (Copy 0)`)).toBe('1 2 8 7');
    });

    it('keeps deferred checks from distinct intermediate bindings', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        try {
            runtime.variables.set('Host', { kind: 'array', shape: [1], items: [],
                itemAt: () => { reads++; return 'wrong'; } });
            runtime.execute("use sequences\nA = array shape 0 fill 0\nA' = concat A Host\nB' = concat A (array 1)");
            expect(reads).toBe(0);
            expect(() => runtime.execute('B 0')).toThrow(/integer/);
            expect(reads).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('keeps deep sequence concatenation lazy and ordered', () => {
        expect(run(`A = 0 till 0
for I in 0 till 10000
 A = concat A (I to I)
end
Total = 0
for X in A
 Total += X
end
Total`)).toBe('49995000');
    }, 30000);
});

describe('concat rope reads and dependencies', () => {
    it('keeps sequential cursors correct across leaf boundaries, jumps and independent readers', () => {
        const parts = Array.from({ length: 100 }, (_, part) =>
            ownedArray(Array.from({ length: part % 7 + 1 }, (_, cell) => BigInt(part * 10 + cell))));
        const expected = parts.flatMap(part => [...part.items]);
        const joined = concatValues(parts) as RankArray;
        const first = prepareIntegerView(joined)!;
        const second = prepareIntegerView(joined)!;
        expect(first).toBeDefined();
        for (let index = 0; index < expected.length; index++) {
            expect(first.read(index)).toBe(expected[index]);
            const reverse = expected.length - index - 1;
            expect(second.read(reverse)).toBe(expected[reverse]);
        }
        for (let index = 0; index < expected.length; index++) {
            const jump = (index * 37) % expected.length;
            expect(first.read(jump)).toBe(expected[jump]);
        }
        expect(Array.from({ length: expected.length }, (_, index) => first.read(index))).toEqual(expected);
    });

    it('handles append, prepend, and balanced joins without recursive reads', () => {
        for (const prepend of [false, true]) {
            let value = ownedArray([]);
            for (let i = 0; i < 10000; i++) {
                const leaf = ownedArray([BigInt(i)]);
                value = concatValues(prepend ? [leaf, value] : [value, leaf]) as RankArray;
            }
            noteArrayBinding(value); // Also covers a deep previously unbound dependency DAG.
            for (let i = 0; i < 10000; i += 37) {
                expect(readArrayItem(value, i)).toBe(BigInt(prepend ? 9999 - i : i));
            }
        }
        let parts = Array.from({ length: 1024 }, (_, i) => ownedArray([BigInt(i)]));
        while (parts.length > 1) parts = Array.from({ length: parts.length / 2 }, (_, i) =>
            concatValues([parts[2 * i], parts[2 * i + 1]]) as RankArray);
        expect(parts[0].items).toEqual(Array.from({ length: 1024 }, (_, i) => BigInt(i)));
    }, 30000);

    it('preserves nonzero-axis coordinates and mixed-axis sources', () => {
        let matrix = ownedArray([], [2, 0]);
        for (let i = 0; i < 1000; i++) matrix = concatValues([
            matrix, ownedArray([BigInt(i), BigInt(1000 + i)], [2, 1]),
        ], 1) as RankArray;
        expect(matrix.shape).toEqual([2, 1000]);
        expect(matrix.items).toEqual(Array.from({ length: 2000 }, (_, i) => BigInt(i)));
        const mixed = concatValues([matrix, matrix], 0) as RankArray;
        const joined = concatValues([mixed, ownedArray([9n, 8n, 7n, 6n], [4, 1])], 1) as RankArray;
        expect([0, 1000, 1001, 2001, 2002, 3002, 3003, 4003].map(i => readArrayItem(joined, i)))
            .toEqual([0n, 9n, 1000n, 8n, 0n, 7n, 1000n, 6n]);
    });

    it('invalidates cached reads for external storage changes without eager reads', () => {
        const leaf = ownedArray([1n]);
        let value = leaf;
        for (let i = 0; i < 4000; i++) value = concatValues([value, ownedArray([2n])]) as RankArray;
        expect(readArrayItem(value, 0)).toBe(1n);
        const revision = arrayRevision(value);
        leaf.items[0] = 9n;
        expect(arrayRevision(value)).not.toBe(revision);
        expect(readArrayItem(value, 0)).toBe(9n);
        expect(readArrayItem(value, 4000)).toBe(2n);
    });

    it('recomputes opaque host cells when a concat is reused', () => {
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [1], items: [], itemAt: () => BigInt(++reads) };
        const first = concatValues([host, ownedArray([0n])]) as RankArray;
        expect(readArrayItem(first, 0)).toBe(1n);
        const second = concatValues([first, first]) as RankArray;
        expect(readArrayItem(second, 0)).toBe(2n);
        expect(readArrayItem(second, 2)).toBe(3n);
        expect(reads).toBe(3);
    });

    it('retains reference cells and rejects cyclic lazy binding cells', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nR = record\n .x = 1\nend\nA = array R\nB = concat A A\nC = concat B A\nC 0 .x');
            expect(runtime.execute('R .x = 9\nC 0 .x')).toBe(9n);
        } finally { runtime.dispose(); }
        const source: RankArray = { kind: 'array', shape: [1], items: [], itemAt: () => source };
        const checked = new ArrayBindingContract('Cycle').check(source);
        expect(() => readArrayItem(checked, 0)).toThrow(/cyclic arrays/);
    });

    it('keeps unknown single-pass and infinite sequence behavior, including early close', () => {
        let reads = 0, closed = 0;
        const iterator = (function* () { try { reads++; yield 1n; yield 2n; } finally { closed++; } })();
        const input = sequence({ name: 'one pass', size: { kind: 'unknown' }, singlePass: true,
            iterate: () => iterator });
        let value = input;
        for (let i = 0; i < 10000; i++) value = concatValues([value, ownedArray([])]) as typeof input;
        expect(value.plan.size).toEqual({ kind: 'unknown' });
        expect(value.plan.singlePass).toBe(true);
        expect(reads).toBe(0);
        const reader = value.plan.iterate();
        expect(reader.next().value).toBe(1n);
        reader.return?.();
        expect(closed).toBe(1);
        expect([...value.plan.iterate()]).toEqual([]);

        const infinite = sequence({ name: 'infinite', size: { kind: 'infinite' },
            *iterate() { for (;;) yield 3n; } });
        const bad = sequence({ name: 'unreachable', size: { kind: 'unknown' },
            *iterate() { throw Error('read unreachable source'); } });
        const joined = concatValues([infinite, bad]);
        expect(isRankSequence(joined) && joined.plan.size).toEqual({ kind: 'infinite' });
        if (!isRankSequence(joined)) throw Error('expected sequence');
        const stream = joined.plan.iterate();
        expect(stream.next().value).toBe(3n);
        expect(stream.next().value).toBe(3n);
        stream.return?.();
    });
});
