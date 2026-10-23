import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { ALL_AXIS, sliceArray, tensorSelection } from '../src/selectors.js';

describe.each([false, true])('ranked integer gathers (compilation=%s)', compilation => {
    function run(source: string, check: (value: RankArray, runtime: Interpreter) => void) {
        const runtime = new Interpreter(() => {}, { compilation, tensorFusion: compilation });
        try {
            const value = runtime.execute(`use sequences\n${source}`)!;
            if (!isRankArray(value)) throw Error('expected array');
            check(value, runtime);
        } finally { runtime.dispose(); }
    }

    it('replaces the leading axis with the full selector shape', () => {
        run('Ps = (0 till 10) * 3\nIx = (0 till 6) reshape 2 3\nPs Ix', value => {
            expect(value.shape).toEqual([2, 3]);
            expect(value.items).toEqual([0n, 3n, 6n, 9n, 12n, 15n]);
        });
        run('A = (0 till 12) reshape 4 3\nIx = (array 2 0 1 2) reshape 2 2\nA Ix', value => {
            expect(value.shape).toEqual([2, 2, 3]);
            expect(value.items).toEqual([6n, 7n, 8n, 0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
        });
    });

    it('supports rank-3 selectors and explicit non-leading axes', () => {
        run('A = array 10 20 30\nIx = ((0 till 8) mod 3) reshape 2 2 2\nA Ix', value => {
            expect(value.shape).toEqual([2, 2, 2]);
            expect(value.items).toEqual([10n, 20n, 30n, 10n, 20n, 30n, 10n, 20n]);
        });
        run('A = (0 till 6) reshape 2 3\nIx = (array 2 0 1 2) reshape 2 2\nA axis 1 Ix', value => {
            expect(value.shape).toEqual([2, 2, 2]);
            expect(value.items).toEqual([2n, 0n, 1n, 2n, 5n, 3n, 4n, 5n]);
        });
    });

    it('combines selector frames in Cartesian order', () => {
        run('A = (0 till 12) reshape 3 4\nI = (array 2 0) reshape 1 2\nJ = (array 3 1) reshape 2 1\nA I J', value => {
            expect(value.shape).toEqual([1, 2, 2, 1]);
            expect(value.items).toEqual([11n, 9n, 3n, 1n]);
        });
    });

    it('preserves empty selector dimensions and trailing source dimensions', () => {
        run('A = array shape 3 4 fill 7\nI = array shape 2 0 3 fill 0\nA I', value => {
            expect(value.shape).toEqual([2, 0, 3, 4]);
            expect(value.items).toEqual([]);
        });
    });

    it('freezes selected indices and source values across writes', () => {
        run('A = array 10 20 30\nI = (array 2 0 2 1) reshape 2 2\nB = A I\nI 0 0 = 1\nA 2 = 99\nB', value => {
            expect(value.shape).toEqual([2, 2]);
            expect(value.items).toEqual([30n, 10n, 30n, 20n]);
        });
    });

    it('uses the same frame for assignment and validates indices before writing', () => {
        run('A = array 10 20 30\nI = (array 2 0 2 1) reshape 2 2\nA I = (array 1 2 3 4) reshape 2 2\nA', (value, runtime) => {
            expect(value.items).toEqual([2n, 4n, 3n]);
            expect(() => runtime.execute('A ((array 0 3) reshape 1 2) = 99')).toThrow('out of bounds');
            expect(value.items).toEqual([2n, 4n, 3n]);
            expect(() => runtime.execute('A I = array 1 2 3 4')).toThrow('assignment shape mismatch');
        });
    });

    it.each([
        ['array 0 -1', 'nonnegative'],
        ['array 0 3', 'out of bounds'],
        ['array 0 9007199254740993', 'out of bounds'],
        ['array 0.0 1.0', 'real elements'],
        ['array 0 .NA', 'boolean mask'],
    ])('rejects invalid ranked indices: %s', (indices, message) => {
        expect(() => run(`A = array 10 20 30\nI = (${indices}) reshape 1 2\nA I`, () => {}))
            .toThrow(message);
    });

    it('keeps full-shape boolean selection as a flat sequence', () => {
        const runtime = new Interpreter(() => {}, { compilation, tensorFusion: compilation });
        try {
            expect(runtime.execute('use sequences\nA = (0 till 6) reshape 2 3\n(A (A greater 2)) array'))
                .toMatchObject({ shape: [3], items: [3n, 4n, 5n] });
        } finally { runtime.dispose(); }
    });
});

it.each(['boxed', 'integer', 'real'])('keeps dense %s gathers in row-major order', storage => {
    const size = 1 << 16;
    const source = storage === 'boxed' ? ownedArray([10n, 20n, 30n])
        : typedArray(storage === 'integer' ? new BigInt64Array([10n, 20n, 30n]) : new Float64Array([10, 20, 30]));
    const indices = typedArray(BigInt64Array.from({ length: size }, (_, i) => BigInt((i * 7) % 3)), [256, 256]);
    const selected = sliceArray(source, tensorSelection(source, [indices]));
    if (!isRankArray(selected)) throw Error('expected array');
    expect(selected.shape).toEqual([256, 256]);
    expect(selected.items).toEqual(Array.from({ length: size }, (_, i) => storage === 'real' ? ((i * 7) % 3 + 1) * 10 : BigInt(((i * 7) % 3 + 1) * 10)));
});

it('keeps a rank-0 integer array selector as a rank-0 array result', () => {
    const source = ownedArray([10n, 20n, 30n]);
    expect(sliceArray(source, tensorSelection(source, [ownedArray([1n], [])])))
        .toMatchObject({ shape: [], items: [20n] });
    expect(sliceArray(source, tensorSelection(source, [1n]))).toBe(20n);
});

it('copies a Cartesian gather from typed matrix storage', () => {
    const source = typedArray(BigInt64Array.from({ length: 12 }, (_, i) => BigInt(i)), [3, 4]);
    expect(sliceArray(source, tensorSelection(source, [
        ownedArray([2n, 0n], [1, 2]), ownedArray([3n, 1n], [2, 1]),
    ]))).toMatchObject({ shape: [1, 2, 2, 1], items: [11n, 9n, 3n, 1n] });
});

it('reads only demanded source cells after validating a lazy ranked selector', () => {
    const reads: number[] = [], indexReads: number[] = [];
    const host: RankArray = { kind: 'array', shape: [3],
        itemAt(index) { reads.push(index); return BigInt(index * 10); },
        get items(): RankValue[] { throw Error('must not collect source'); } };
    const indices: RankArray = { kind: 'array', shape: [2, 2],
        itemAt(index) { indexReads.push(index); return [2n, 0n, 2n, 1n][index]; },
        get items(): RankValue[] { throw Error('must not collect indices'); } };
    const result = sliceArray(host, tensorSelection(host, [indices]));
    expect(new Set(indexReads)).toEqual(new Set([0, 1, 2, 3]));
    expect(reads).toEqual([]);
    if (!isRankArray(result)) throw Error('expected array');
    expect(result.itemAt!(2)).toBe(20n);
    expect(reads).toEqual([2]);
    expect(() => tensorSelection(ownedArray([1n, 2n]), [ALL_AXIS, indices])).toThrow('at most 1 selectors');
});
