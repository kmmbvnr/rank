import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';

for (const compilation of [true, false]) {
    it(`streams outer values and keys without matrix buffers (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const rows = 80, columns = 91;
        try {
            runtime.execute(`use sequences\nA = 1 to ${rows}\nB = 1 to ${columns}\nI = 0 till ${rows}\nJ = 0 till ${columns}`);
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute('(A B outer *) reduce + by (I J outer +)'));
            if (result === undefined || !isRankArray(result)) throw new Error('expected array');
            const expected = Array(rows + columns - 1).fill(0n) as bigint[];
            for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
                expected[i + j] += BigInt(i + 1) * BigInt(j + 1);
            }
            expect(result.shape).toEqual([expected.length]);
            expect(expected.map((_, i) => readArrayItem(result, i))).toEqual(expected);
            expect(diagnostics.keyedNativeReaders).toBe(compilation ? 2 : 0);
            expect(diagnostics.typedArrayPublishedCells).toBeLessThanOrEqual(expected.length);
        } finally { runtime.dispose(); }
    });
}
it('keeps nested pointwise and outer arithmetic exact', () => {
    const results = [true, false].map(compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use sequences\nA = array 9007199254740993 2\nB = array 3 5 7\nI = array 0 1\nJ = array 0 1 2');
            const value = runtime.execute('((A B outer *) + 1) reduce + by (I J outer +)');
            if (value === undefined || !isRankArray(value)) throw new Error('expected array');
            return Array.from({ length: 4 }, (_, i) => readArrayItem(value, i));
        } finally { runtime.dispose(); }
    });
    expect(results[0]).toEqual(results[1]);
});
it('preserves division errors in native producers', () => {
    for (const compilation of [true, false]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('A = array 1 2\nB = array 0 1\nK = array 0 1');
            expect(() => runtime.execute('(A // B) reduce + by K')).toThrow(/division by zero/);
        } finally { runtime.dispose(); }
    }
});
it('keeps effectful user reducers on ordinary reads', () => {
    const output: string[] = [];
    const runtime = new Interpreter(text => output.push(text));
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('use io\nfun A tracked B\n A print\n return A + B\nend\n'
            + 'A = array 1 2\nB = array 3 4 5\nI = array 0 1\nJ = array 0 1 2');
        diagnostics.run(() => runtime.execute('(A B outer *) reduce tracked by (I J outer +) with 0'));
        expect(output).toHaveLength(6);
        expect(diagnostics.keyedNativeReaders).toBe(0);
    } finally { runtime.dispose(); }
});
it('matches direct anti-diagonal folds on rectangular and empty shapes', () => {
    for (const [rows, columns] of [[0, 3], [3, 0], [1, 5], [5, 1], [2, 3], [4, 4]]) {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(`use sequences\nM = (1 to ${rows * columns}) reshape ${rows} ${columns}\n`
                    + `I = 0 till ${rows}\nJ = 0 till ${columns}\nfun A append B = A * 10 + B`);
                for (const operation of ['+', '-', 'max', 'append']) {
                    const expected: (bigint | undefined)[] = [];
                    for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
                        const key = i + j, value = BigInt(i * columns + j + 1), previous = expected[key];
                        expected[key] = previous === undefined ? value : operation === '+' ? previous + value
                            : operation === '-' ? previous - value : operation === 'max' ? previous > value ? previous : value
                                : previous * 10n + value;
                    }
                    const result = runtime.execute(`M reduce ${operation} by (I J outer +)`);
                    if (result === undefined || !isRankArray(result)) throw new Error('expected array');
                    expect(result.shape).toEqual([expected.length]);
                    expect(expected.map((_, i) => readArrayItem(result, i))).toEqual(expected);
                }
            } finally { runtime.dispose(); }
        }
    }
});
