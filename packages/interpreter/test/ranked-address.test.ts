import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';

describe.each([false, true])('ranked addressing (compilation=%s)', compilation => {
    const run = (source: string) => {
        const runtime = new Interpreter(() => {}, { compilation, tensorFusion: compilation });
        try { return runtime.execute(`use sequences\n${source}`); }
        finally { runtime.dispose(); }
    };

    it('pairs scalar indices while preserving ordinary Cartesian selection', () => {
        const setup = 'A = (0 till 12) reshape 3 4\nRows = array 0 2\nCols = array 1 3\n';
        expect(run(setup + 'A Rows Cols rank 0 0')).toMatchObject({ shape: [2], items: [1n, 11n] });
        expect(run(setup + 'A Rows Cols rank 0 1')).toMatchObject({ shape: [2, 2], items: [1n, 3n, 9n, 11n] });
        expect(run(setup + 'A Rows Cols')).toMatchObject({ shape: [2, 2], items: [1n, 3n, 9n, 11n] });
    });

    it('preserves whole axes inside each paired result', () => {
        expect(run('T = (0 till 24) reshape 2 3 4\nRows = array 0 1\nCols = array 3 0\nT Rows # Cols rank 0 # 0'))
            .toMatchObject({ shape: [2, 3], items: [3n, 7n, 11n, 12n, 16n, 20n] });
    });

    it('treats omitted trailing axes like explicit fixed whole axes', () => {
        const setup = 'T = (0 till 24) reshape 2 3 4\nI = array 0 1\nJ = array 2 0\n';
        const expected = { shape: [2, 4], items: [8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n] };
        expect(run(setup + 'T I J rank 0 0')).toMatchObject(expected);
        expect(run(setup + 'T I J # rank 0 0 #')).toMatchObject(expected);
    });

    it('transposes columns and leaves all-fixed selections unchanged', () => {
        const setup = 'A = (0 till 6) reshape 2 3\nCols = array 0 1 2\n';
        expect(run(setup + 'A # Cols rank # 0')).toMatchObject({ shape: [3, 2], items: [0n, 3n, 1n, 4n, 2n, 5n] });
        expect(run(setup + 'A # # rank # #')).toMatchObject({ shape: [2, 3], items: [0n, 1n, 2n, 3n, 4n, 5n] });
        expect(run(setup + 'A 1 # rank 0 #')).toMatchObject({ shape: [3], items: [3n, 4n, 5n] });
    });

    it('supports three indexed axes', () => {
        expect(run('A = (0 till 24) reshape 2 3 4\nI = array 0 1\nJ = array 2 0\nK = array 1 3\nA I J K rank 0 0 0'))
            .toMatchObject({ shape: [2], items: [9n, 15n] });
    });

    it('rejects unpack selectors explicitly for ranked reads and writes', () => {
        const setup = 'A = (0 till 6) reshape 2 3\nPoint = array 0 1\n';
        expect(() => run(setup + 'A unpack Point rank 0')).toThrow(/does not support unpack selectors/);
        expect(() => run(setup + 'A unpack Point rank 0 = 7')).toThrow(/does not support unpack selectors/);
    });

    it('matches an independent coordinate loop across rectangular sources', () => {
        for (const [height, width] of [[1, 5], [3, 2], [4, 7]]) {
            const rows = Array.from({ length: 9 }, (_, i) => (i * 3 + 1) % height);
            const columns = Array.from({ length: 9 }, (_, i) => (i * 5 + 2) % width);
            const matrix = Array.from({ length: height }, (_, row) =>
                Array.from({ length: width }, (_, column) => BigInt(row * width + column)));
            const expected: bigint[] = [];
            for (let i = 0; i < rows.length; i++) expected.push(matrix[rows[i]][columns[i]]);
            expect(run(`A = (0 till ${height * width}) reshape ${height} ${width}\nI = array ${rows.join(' ')}\nJ = array ${columns.join(' ')}\nA I J rank 0 0`))
                .toMatchObject({ shape: [rows.length], items: expected });
        }
    });

    it('evaluates the source once before iterating selector frames', () => {
        expect(run('use algo\nCalls = new queue\nfun Log source\n Log push 1\n return (0 till 6) reshape 2 3\nend\nI = array 0 1\nJ = array 2 0\nPicked = (Calls source) I J rank 0 0\nCalls len')).toBe(1n);
    });

    it('accepts lowercase scalar selectors and bounded range frames', () => {
        expect(run('A = (0 till 6) reshape 2 3\nResult = 0\nfor i in 1 to 1\n for j in 2 to 2\n  Result = A i j rank 0 0\n end\nend\nResult')).toBe(5n);
        expect(run('A = (0 till 6) reshape 2 3\nA (0 till 2) 2 rank 0 0'))
            .toMatchObject({ shape: [2], items: [2n, 5n] });
    });

    it('broadcasts multidimensional frames and rejects incompatible frames', () => {
        const setup = 'A = (0 till 6) reshape 2 3\nI = (array 0 1) reshape 2 1\nJ = (array 0 1 2) reshape 1 3\n';
        expect(run(setup + 'A I J rank 0 0'))
            .toMatchObject({ shape: [2, 3], items: [0n, 1n, 2n, 3n, 4n, 5n] });
        expect(() => run('A = array shape 3 3 fill 0\nI = array 0 1\nJ = array 0 1 2\nA I J rank 0 0')).toThrow(/shape mismatch/);
    });

    it('pairs vector cells rather than taking their Cartesian product across frames', () => {
        expect(run('A = (0 till 20) reshape 4 5\nI = (array 0 1 2 3) reshape 2 2\nJ = (array 0 2 4 1 2 3) reshape 2 3\nA I J rank 1 1'))
            .toMatchObject({ shape: [2, 2, 3], items: [0n, 2n, 4n, 5n, 7n, 9n, 11n, 12n, 13n, 16n, 17n, 18n] });
    });

    it('supports mixed cell ranks and negative or excess ranks', () => {
        const setup = 'A = (0 till 20) reshape 4 5\nI = (array 0 1 2 3) reshape 2 2\nJ = (array 0 1 2 3 4 0 1 2) reshape 2 2 2\n';
        const expected = [0n, 1n, 2n, 3n, 5n, 6n, 7n, 8n, 14n, 10n, 11n, 12n, 19n, 15n, 16n, 17n];
        expect(run(setup + 'A I J rank 1 2')).toMatchObject({ shape: [2, 2, 2, 2], items: expected });
        expect(run(setup + 'A I J rank -1 -1')).toMatchObject({ shape: [2, 2, 2, 2], items: expected });
        expect(run('A = (0 till 6) reshape 2 3\nI = array 0 1\nJ = array 2 0\nA I J rank 9 9'))
            .toMatchObject({ shape: [2, 2], items: [2n, 0n, 5n, 3n] });
    });

    it('assembles uniform ranked masks and rejects unequal cell lengths', () => {
        const setup = 'A = (0 till 6) reshape 2 3\nI = array 0 1\n';
        expect(run(setup + 'Masks = (array true false true false true true) reshape 2 3\nA I Masks rank 0 1'))
            .toMatchObject({ shape: [2, 2], items: [0n, 2n, 4n, 5n] });
        expect(() => run(setup + 'Masks = (array true false true false true false) reshape 2 3\nSaved = A I Masks rank 0 1\nSaved'))
            .toThrow(/one shape/);
    });

    it('snapshots overlapping RHS data and isolates array aliases', () => {
        expect(run('A = (0 till 6) reshape 2 3\nAlias = A\nI = array 0 1\nJ = array 2 0\nA I J rank 0 0 = A (array 1 0) (array 0 2) rank 0 0\nAlias'))
            .toMatchObject({ items: [0n, 1n, 2n, 3n, 4n, 5n] });
        expect(run('A = (0 till 6) reshape 2 3\nI = array 0 1\nJ = array 2 0\nA I J rank 0 0 = A (array 1 0) (array 0 2) rank 0 0\nA'))
            .toMatchObject({ items: [0n, 1n, 3n, 2n, 4n, 5n] });
    });

    it('writes corresponding coordinates with snapshot and accumulation semantics', () => {
        const setup = 'A = array shape 2 3 fill 0\nI = array 0 1 0\nJ = array 2 0 2\n';
        expect(run(setup + 'A I J rank 0 0 = array 4 5 6\nA'))
            .toMatchObject({ shape: [2, 3], items: [0n, 0n, 6n, 5n, 0n, 0n] });
        expect(run(setup + 'A I J rank 0 0 += 1\nA'))
            .toMatchObject({ items: [0n, 0n, 1n, 1n, 0n, 0n] });
        expect(run(setup + 'A I J rank 0 0 += 1 .accumulate\nA'))
            .toMatchObject({ items: [0n, 0n, 2n, 1n, 0n, 0n] });
    });

    it('orders overlapping block writes by frame and then cell', () => {
        const setup = 'A = array shape 3 3 fill 0\nI = (array 0 1 1 2) reshape 2 2\nJ = (array 0 1 1 2) reshape 2 2\n';
        expect(run(setup + 'A I J rank 1 1 = (1 to 8) reshape 2 2 2\nA'))
            .toMatchObject({ items: [1n, 2n, 0n, 3n, 5n, 6n, 0n, 7n, 8n] });
        expect(run(setup + 'A I J rank 1 1 += 1 .accumulate\nA'))
            .toMatchObject({ items: [1n, 1n, 0n, 1n, 2n, 1n, 0n, 1n, 1n] });
    });

    it('writes three indexed axes', () => {
        const expected = Array<bigint>(24).fill(0n);
        expected[9] = 4n;
        expected[15] = 5n;
        expect(run('A = array shape 2 3 4 fill 0\nI = array 0 1\nJ = array 2 0\nK = array 1 3\nA I J K rank 0 0 0 = array 4 5\nA'))
            .toMatchObject({ shape: [2, 3, 4], items: expected });
    });

    it('keeps integer writes exact when packed storage must widen', () => {
        for (const initial of [2147483647n, 9223372036854775807n]) {
            expect(run(`A = array shape 2 3 fill ${initial}\nI = array 0 1\nJ = array 1 2\nA I J rank 0 0 += 1\nA`))
                .toMatchObject({ items: [initial, initial + 1n, initial, initial, initial, initial + 1n] });
        }
    });

    it('uses frame-first shapes for whole-axis writes', () => {
        expect(run('A = array shape 2 3 fill 0\nCols = array 2 0\nA # Cols rank # 0 = (array 1 2 3 4) reshape 2 2\nA'))
            .toMatchObject({ shape: [2, 3], items: [3n, 0n, 1n, 4n, 0n, 2n] });
    });

    it('retains eager snapshots and deferred creation-time dependencies', () => {
        expect(run('A = (0 till 6) reshape 2 3\nI = array 0 1\nJ = array 2 0\nSaved = A I J rank 0 0\nA 0 2 = 99\nSaved'))
            .toMatchObject({ shape: [2], items: [2n, 3n] });
        expect(run("A = (0 till 6) reshape 2 3\nI = array 0 1\nJ = array 2 0\nPlan' = A I J rank 0 0\nA = array shape 2 3 fill 99\nPlan"))
            .toMatchObject({ shape: [2], items: [2n, 3n] });
        expect(() => run("A = (0 till 6) reshape 2 3\nI = array 0 1\nJ = array 2 0\nPlan' = A I J rank 0 0\nA 0 2 = 99"))
            .toThrow(/read-only/);
        expect(run("A = (0 till 6) reshape 2 3\nI = array 0 1\nJ = array 2 0\nAlias = A\nIndexAlias = I\nPlan' = A I J rank 0 0\nAlias 0 2 = 99\nIndexAlias 0 = 1\nSaved = Plan\nSaved"))
            .toMatchObject({ shape: [2], items: [2n, 3n] });
    });

    it('keeps empty frames and singleton frames distinct from scalar selectors', () => {
        expect(run('A = array shape 2 3 fill 0\nI = array shape 0 fill 0\nA I # rank 0 #'))
            .toMatchObject({ shape: [0, 3], items: [] });
        expect(run('A = array shape 2 3 fill 0\nI = array 1\nA I # rank 0 #'))
            .toMatchObject({ shape: [1, 3], items: [0n, 0n, 0n] });
        expect(run('A = array shape 2 3 fill 0\nI = array shape 0 fill 0\nMasks = array shape 0 3 fill false\nA I Masks rank 0 1'))
            .toMatchObject({ shape: [0, 0], items: [] });
    });

    it('validates all write coordinates before changing any destination', () => {
        const runtime = new Interpreter(() => {}, { compilation, tensorFusion: compilation });
        try {
            runtime.execute('A = array shape 2 3 fill 0\nI = array 0 2\nJ = array 1 1');
            expect(() => runtime.execute('A I J rank 0 0 = 9')).toThrow(/out of bounds/);
            expect(runtime.execute('A')).toMatchObject({ items: [0n, 0n, 0n, 0n, 0n, 0n] });
        } finally { runtime.dispose(); }
    });

    it.each(['A I # rank 0 0', 'A I J rank 0 #', 'A I J rank 0', 'A I J rank 0 0 0'])(
        'rejects inconsistent rank positions: %s', expression => {
            expect(() => run(`A = array shape 2 3 fill 0\nI = array 0 1\nJ = array 1 2\n${expression}`)).toThrow(/rank/);
        });

    it('does not demand source or selector cells when declaring a plan and recomputes on demand', () => {
        const sourceReads: number[] = [], indexReads: number[] = [];
        const source: RankArray = { kind: 'array', shape: [2, 3],
            itemAt(index) { sourceReads.push(index); return BigInt(index); },
            get items(): never { throw Error('source must not be collected'); } };
        const indices: RankArray = { kind: 'array', shape: [2],
            itemAt(index) { indexReads.push(index); return BigInt(index); },
            get items(): never { throw Error('indices must not be collected'); } };
        const runtime = new Interpreter(() => {}, { compilation, tensorFusion: compilation });
        try {
            runtime.variables.set('A', source);
            runtime.variables.set('I', indices);
            runtime.execute("Plan' = A I 2 rank 0 0");
            expect(sourceReads).toEqual([]);
            expect(indexReads).toEqual([]);
            expect(runtime.execute('Plan 1')).toBe(5n);
            expect(sourceReads).toEqual([5]);
            expect(indexReads).toEqual([1]);
            expect(runtime.execute('Plan 1')).toBe(5n);
            expect(sourceReads).toEqual([5, 5]);
            expect(indexReads).toEqual([1, 1]);
        } finally { runtime.dispose(); }
    });
});

it('cancels destination preparation before changing the array', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute('use sequences\nA = array shape 10000 2 fill 0\nI = (0 till 10000) array');
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => runtime.execute('A I 1 rank 0 0 = 7'))).toThrow(InterruptedError);
        expect(runtime.execute('A sum')).toBe(0n);
    } finally { runtime.dispose(); }
});

it('preserves cancellation during bulk commit without replaying writes', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('use sequences\nA = array shape 10000 2 fill 0\nI = (0 till 10000) array');
        const signal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => diagnostics.bulkArrayWrites ? 1 : 0 };
        expect(() => withInterrupt(signal, () => diagnostics.run(() => runtime.execute('A I 1 rank 0 0 += 1\nAfter = 1'))))
            .toThrow(InterruptedError);
        expect(runtime.variables.has('After')).toBe(false);
        const sum = runtime.execute('A sum') as bigint;
        expect(sum).toBeGreaterThan(0n);
        expect(sum).toBeLessThan(10000n);
    } finally { runtime.dispose(); }
});
