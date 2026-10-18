import { describe, expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, isRankArray, type RankValue } from '../src/index.js';
import { derivedArray, ownedArray, prepareArrayRead } from '../src/array-storage.js';
import { concatValues } from '../src/modules/sequences.js';
import type { RankArray } from '../src/value.js';
import { ArrayBindingContract } from '../src/array-binding-contract.js';
import { prepareIntegerView, registerScalarView } from '../src/integer-view.js';
import { withInterrupt } from '../src/interrupt.js';

it('copies a selected integer view into independent writable storage', () => {
    const runtime = new Interpreter();
    runtime.execute(`use sequences
M = (array 1 2 3 4 5 6) reshape 3 2
M = M copy
P = M (array 2 0 2)
C = P copy
C 0 0 = 99`);
    expect(runtime.execute('C 0 0')).toBe(99n);
    expect(runtime.execute('P 0 0')).toBe(5n);
    expect(runtime.execute('M 2 0')).toBe(5n);
    expect(runtime.execute('C 2 0')).toBe(5n);
});

it('does not bypass host readers or force their items getter', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    const reads: number[] = [];
    runtime.variables.set('Host', { kind: 'array', shape: [3], get items(): RankValue[] { throw Error('forced'); },
        itemAt: i => { reads.push(i); return BigInt(i); } });
    runtime.execute('C = Host copy');
    expect(reads).toEqual([0, 1, 2]);
    const copied = runtime.variables.get('C')!;
    expect(isRankArray(copied) && copied.items).toEqual([0n, 1n, 2n]);
});

it('does not invoke host array copying methods or copy beyond its shape', () => {
    const runtime = new Interpreter();
    const items = [1n, 2n, 3n];
    items.slice = () => { throw Error('host slice'); };
    try {
        runtime.variables.set('Host', { kind: 'array', shape: [2], items });
        const copied = runtime.execute('use sequences\nHost copy') as RankArray;
        expect(copied.shape).toEqual([2]);
        expect(copied.items).toEqual([1n, 2n]);
    } finally { runtime.dispose(); }
});

it('retains late failures in a lazy integer-looking input', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    const reads: number[] = [];
    runtime.variables.set('Host', { kind: 'array', shape: [3], items: [], itemAt: i => {
        reads.push(i);
        if (i === 2) throw Error('late failure');
        return BigInt(i);
    } });
    expect(() => runtime.execute('Host copy')).toThrow('late failure');
    expect(reads).toEqual([0, 1, 2]);
});

it('rechecks an escaped snapshot instead of trusting a stale integer proof', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    const source = createArraySnapshot([1n, 2n]);
    runtime.variables.set('Input', source);
    runtime.execute('First = Input copy');
    source.items[1] = 'bad';
    expect(() => runtime.execute('Second = Input copy')).toThrow();
});

for (const compilation of [false, true]) describe(`integer concat copy (compiled=${compilation})`, () => {
    it.each([
        [0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]],
        [1, [1, 2, 3, 4, 9, 10, 11, 12, 5, 6, 7, 8, 13, 14, 15, 16]],
        [2, [1, 2, 9, 10, 3, 4, 11, 12, 5, 6, 13, 14, 7, 8, 15, 16]],
    ] as [number, number[]][])('copies rank-three integer leaves along axis %i', (axis, expected) => {
        const left = ownedArray([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n], [2, 2, 2]);
        const right = ownedArray([9n, 10n, 11n, 12n, 13n, 14n, 15n, 16n], [2, 2, 2]);
        const joined = concatValues([left, right], axis) as RankArray;
        expect(prepareArrayRead(joined)).toBeTypeOf('function');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Input', joined);
            const copied = runtime.execute('use sequences\nInput copy') as RankArray;
            expect(copied.shape).toEqual(left.shape.map((size, i) => i === axis ? size * 2 : size));
            expect(copied.items).toEqual(expected.map(BigInt));
            copied.items[0] = 99n;
            expect(left.items[0]).toBe(1n);
            left.items[0] = 42n;
            expect((runtime.execute('Input copy') as RankArray).items[0]).toBe(42n);
        } finally { runtime.dispose(); }
    });

    it('keeps opaque concat readers on the ordered fallback, including late errors', () => {
        const reads: number[] = [];
        const host: RankArray = { kind: 'array', shape: [3], items: [], itemAt: index => {
            reads.push(index);
            if (index === 2) throw Error('late concat failure');
            return BigInt(index);
        } };
        const joined = concatValues([ownedArray([9n]), host]) as RankArray;
        expect(prepareArrayRead(joined)).toBeUndefined();
        expect(reads).toEqual([]);
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Input', joined);
            expect(() => runtime.execute('use sequences\nInput copy')).toThrow('late concat failure');
            expect(reads).toEqual([0, 1, 2]);
        } finally { runtime.dispose(); }
    });
});

it('keeps unestablished binding checks deferred until the prepared copy reads', () => {
    const contract = new ArrayBindingContract('Input');
    const checked = contract.check(concatValues([ownedArray([1n]), ownedArray([2n])])) as RankArray;
    const copy = prepareIntegerView(checked, true);
    // The concat itself is not a direct integer view, but its prepared reader
    // must still apply the outer contract after the source cell is read.
    expect(copy).toBeUndefined();
    const read = prepareArrayRead(checked)!;
    contract.check(ownedArray(['text']));
    expect(() => read(0)).toThrow(/text|integer/);
});

it('applies unestablished integer-view checks when copying a selection', () => {
    const contract = new ArrayBindingContract('Input');
    const source = ownedArray([1n, 2n]);
    const selection = registerScalarView(derivedArray([2], [source], index => source.items[index]), source, index => index);
    const checked = contract.check(selection) as RankArray;
    const read = prepareIntegerView(checked, true)!;
    expect(read).toBeDefined();
    contract.check(ownedArray(['text']));
    expect(() => read.read(0)).toThrow(/text|integer/);
});

it('disables prepared concat reads while inspecting execution', () => {
    const joined = concatValues([ownedArray([1n]), ownedArray([2n])]) as RankArray;
    const signal = new Int32Array(new SharedArrayBuffer(12));
    withInterrupt(signal, () => expect(prepareArrayRead(joined)).toBeUndefined(), () => {});
});
