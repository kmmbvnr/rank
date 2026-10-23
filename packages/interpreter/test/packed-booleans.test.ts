import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, withDemandBudget, DemandBudgetExhausted, withInterrupt, RuntimeDiagnostics } from '../src/index.js';
import { filledArray, readArrayItem, writeArrayCell, privateArrayCopy, reshapeStoredArray, borrowArrayStorage, prepareScalarArrayReader, prepareScalarArrayWriter } from '../src/array-storage.js';
import { ownedStorage } from '../src/array-storage-state.js';
import { ownedArray } from '../src/array-storage.js';
import { copyArray } from '../src/modules/sequences.js';
import { Operators } from '../src/operators.js';
import { shiftValue } from '../src/sequence.js';
import { countPackedBooleans, countPackedBooleanRange, packedTruePositions } from '../src/packed-booleans.js';
import { sliceArray, tensorSelection } from '../src/selectors.js';
import type { RankArray } from '../src/value.js';
import { ArrayBindingContract } from '../src/array-binding-contract.js';
import { readFileSync } from 'node:fs';

describe('packed boolean storage', () => {
    for (const length of [0, 1, 31, 32, 33, 65, 1000001]) it(`allocates and copies ${length} bits`, () => {
        const a = filledArray(true, [length]);
        const cells = ownedStorage.get(a)!.booleans!;
        expect(cells.words.byteLength).toBe(4 * Math.ceil(length / 32));
        expect(ownedStorage.get(a)!.typed).toBeUndefined();
        const b = privateArrayCopy(a);
        if (length) {
            writeArrayCell(b, length - 1, false);
            expect(readArrayItem(a, length - 1)).toBe(true);
            expect(readArrayItem(b, length - 1)).toBe(false);
        }
        expect(ownedStorage.get(a)!.booleans).toBe(cells);
        expect(ownedStorage.get(b)!.booleans!.words.buffer).not.toBe(cells.words.buffer);
        if (length % 32) expect(cells.words.at(-1)! >>> (length % 32)).toBe(0);
    });

    it('keeps compiled reads and writes packed, and exposes tracked JS items on demand', () => {
        const a = filledArray(false, [65]);
        const borrowed = borrowArrayStorage(a)!;
        const read = prepareScalarArrayReader(borrowed, () => { throw Error('fallback'); });
        const write = prepareScalarArrayWriter(borrowed);
        write(32, true);
        expect(read(32n)).toBe(true);
        expect(ownedStorage.get(a)!.booleans).toBeDefined();
        expect(Array.isArray(a.items)).toBe(true);
        expect(ownedStorage.get(a)!.booleans).toBeUndefined();
        a.items[32] = false;
        expect(read(32n)).toBe(false);
    });

    it('falls back to ordinary storage for a non-boolean host write', () => {
        const a = filledArray(false, [33]);
        writeArrayCell(a, 3, 42n);
        expect(readArrayItem(a, 3)).toBe(42n);
        expect(readArrayItem(a, 4)).toBe(false);
        expect(ownedStorage.get(a)!.booleans).toBeUndefined();
    });

    it('shares reshaped buffers safely across Rank writes', () => {
        const a = filledArray(false, [33]);
        const b = reshapeStoredArray(a, [3, 11])!;
        expect(ownedStorage.get(b)!.booleans).toBe(ownedStorage.get(a)!.booleans);
        const c = privateArrayCopy(b);
        writeArrayCell(c, 32, true);
        expect(readArrayItem(a, 32)).toBe(false);
    });

    for (const compilation of [false, true]) it(`preserves aliasing and addressing (compiled=${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            expect(formatValue(runtime.execute(`use sequences
A = array shape 33 fill false
Saved = A
A 32 = true
array (A count) (Saved count)`)!)).toBe('1 0');
            expect(() => runtime.execute('A 33 = true')).toThrow(/bounds/);
            expect(() => runtime.execute('A 0 = 1')).toThrow();
        } finally { runtime.dispose(); }
    });
});

describe('packed boolean kernels', () => {
    const operators = new Operators(() => {}, () => undefined);
    for (const length of [0, 1, 31, 32, 33, 63, 64, 65, 129]) {
        it(`matches ordinary arrays through shifts and logical chains, length ${length}`, () => {
            const source = Array.from({ length }, (_, i) => (i * 7919 % 17) < 8);
            const a = ownedArray([...source]);
            // Empty storage has no inferred cell kind; explicit fill is boolean.
            const input = length ? a : filledArray(false, [0]);
            for (const shift of [-length - 1, -33, -32, -1, 0, 1, 31, 32, 33, length + 1]) {
                const shifted = shiftValue(input, BigInt(shift), false) as RankArray;
                const expectedShift = source.map((_, i) => source[i - shift] ?? false);
                expect(copyArray(shifted).items).toEqual(expectedShift);
                for (const operator of ['and', 'or', 'xor']) {
                    const result = operators.evaluateBinary(operator, input, shifted) as RankArray;
                    const expected = source.map((x, i) => operator === 'and' ? x && expectedShift[i]
                        : operator === 'or' ? x || expectedShift[i] : x !== expectedShift[i]);
                    expect(countPackedBooleans(result)).toBe(BigInt(expected.filter(Boolean).length));
                    expect(packedTruePositions(result)).toEqual(expected.flatMap((x, i) => x ? [i] : []));
                    const copy = copyArray(result);
                    expect(ownedStorage.get(copy)!.booleans).toBeDefined();
                    expect(copy.items).toEqual(expected);
                }
                const not = operators.evaluateUnary('not', shifted) as RankArray;
                expect(countPackedBooleans(not)).toBe(BigInt(expectedShift.filter(x => !x).length));
                expect(copyArray(not).items).toEqual(expectedShift.map(x => !x));
            }
            if (length) expect(ownedStorage.get(input)!.booleans).toBeDefined();
        });
    }

    it('reads unaligned matrix rows as packed words without repacking', () => {
        const source = Array.from({ length: 5 * 33 }, (_, i) => i % 3 === 0 || i % 7 === 0);
        const matrix = ownedArray(source, [5, 33]);
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
            const row = (k: number) => sliceArray(matrix, tensorSelection(matrix, [BigInt(k)])) as RankArray;
            const common = operators.evaluateBinary('and', row(i), row(j)) as RankArray;
            expect(countPackedBooleans(common)).toBe(BigInt(source.slice(i * 33, (i + 1) * 33)
                .filter((x, k) => x && source[j * 33 + k]).length));
            expect(ownedStorage.get(matrix)!.booleans).toBeDefined();
        }
    });

    it('keeps lazy recipes live after writes, including host exposure and replacement', () => {
        const a = filledArray(false, [33]);
        const shifted = shiftValue(a, 1n, false) as RankArray;
        const mask = operators.evaluateBinary('or', a, shifted) as RankArray;
        writeArrayCell(a, 0, true);
        expect(countPackedBooleans(mask)).toBe(2n);
        expect(copyArray(mask).items.slice(0, 3)).toEqual([true, true, false]);
        a.items[0] = false;
        a.items[3] = true;
        expect(countPackedBooleans(mask)).toBeUndefined();
        expect(copyArray(mask).items.slice(0, 6)).toEqual([false, false, false, true, true, false]);
        Reflect.set(a, 'items', Array(33).fill(false));
        expect(copyArray(mask).items).toEqual(Array(33).fill(false));
    });

    for (const columns of [0, 1, 3, 31, 32, 33, 65]) it(`broadcasts rows and counts contiguous cells with ${columns} columns`, () => {
        const values = Array.from({ length: 5 * columns }, (_, i) => i % 3 === 0);
        const row = Array.from({ length: columns }, (_, i) => i % 7 < 4);
        const matrix = columns ? ownedArray(values, [5, columns]) : filledArray(false, [5, 0]);
        for (const shape of [[columns], [1, columns]]) {
            const mask = columns ? ownedArray(row, shape) : filledArray(false, shape);
            for (const operator of ['and', 'or', 'xor']) {
                const result = operators.evaluateBinary(operator, matrix, mask) as RankArray;
                const expected = values.map((x, i) => operator === 'and' ? x && row[i % columns]
                    : operator === 'or' ? x || row[i % columns] : x !== row[i % columns]);
                for (let r = 0; r < 5; r++) expect(countPackedBooleanRange(result, r * columns, columns))
                    .toBe(BigInt(expected.slice(r * columns, (r + 1) * columns).filter(Boolean).length));
                expect(copyArray(result).items).toEqual(expected);
            }
        }
        expect(ownedStorage.get(matrix)!.booleans).toBeDefined();
    });

    for (const compilation of [false, true]) it(`retains lazy axis counts and validates axes (compiled=${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            expect(formatValue(runtime.execute(`use sequences
Grid = array shape 3 33 fill true
Row = array shape 33 fill true
Counts' = (Grid and Row) count axis 1
Counts copy`)!)).toBe('33 33 33');
            expect(() => runtime.execute('(Grid and Row) count axis 2')).toThrow(/axis/);
            expect(() => runtime.execute('(Grid and Row) count axis 1 1')).toThrow(/unique/);
            expect(formatValue(runtime.execute('Grid count axis 0')!)).toBe(Array(33).fill('3').join(' '));
        } finally { runtime.dispose(); }
    });

    it('polls bulk word work and keeps inspection on the ordinary path', () => {
        const a = filledArray(true, [8193]);
        expect(() => withDemandBudget(4096, () => countPackedBooleans(a))).toThrow(DemandBudgetExhausted);
        expect(() => withDemandBudget(4096, () => copyArray(a))).toThrow(DemandBudgetExhausted);
        const flag = new Int32Array(new SharedArrayBuffer(12));
        expect(withInterrupt(flag, () => countPackedBooleans(a), () => {})).toBeUndefined();
        expect(countPackedBooleans(a)).toBe(8193n);
    });

    it('checks deferred binding domains before admitting their boolean words', () => {
        const contract = new ArrayBindingContract('Input');
        contract.check(ownedArray([1n]));
        const lazy = shiftValue(filledArray(false, [33]), 0n, false) as RankArray;
        const checked = contract.check(lazy);
        expect(() => countPackedBooleans(checked)).toThrow(/Input.*elements/);
        // These native views demand no source cells, so an incompatible source
        // domain remains deferred rather than becoming a speculative error.
        const shifted = shiftValue(checked, 33n, false) as RankArray;
        expect(countPackedBooleans(shifted)).toBe(0n);
        expect(copyArray(shifted).items).toEqual(Array(33).fill(false));
        const none = sliceArray(checked, { shape: [0], offsetAt: () => 0, linear: { offset: 0, stride: 1 } }) as RankArray;
        expect(countPackedBooleans(none)).toBe(0n);
        const emptyMap = operators.evaluateBinary('and', filledArray(false, [0, 33]), checked) as RankArray;
        expect(countPackedBooleans(emptyMap)).toBe(0n);
        expect(copyArray(emptyMap).items).toEqual([]);
        const nonempty = operators.evaluateBinary('and', filledArray(false, [2, 33]), checked) as RankArray;
        expect(() => countPackedBooleans(nonempty)).toThrow(/Input.*elements/);
        expect(() => countPackedBooleans(shiftValue(checked, 1n, false) as RankArray)).toThrow(/Input.*elements/);
        const empty = shiftValue(filledArray(false, [0]), 0n, false) as RankArray;
        expect(countPackedBooleans(contract.check(empty))).toBe(0n);
    });

    it('keeps compiler-produced boolean copies packed and word reductions unpack-free', () => {
        const runtime = new Interpreter();
        try {
            const result = runtime.execute(`use sequences
Values = (0 till 8193) copy
(Values less 4000) copy`) as RankArray;
            expect(ownedStorage.get(result)!.booleans!.words.byteLength).toBe(1028);
            expect(countPackedBooleans(result)).toBe(4000n);
            runtime.variables.set('Mask', result);
            const diagnostics = new RuntimeDiagnostics();
            expect(diagnostics.run(() => runtime.execute('(Mask and Mask) count'))).toBe(4000n);
            expect(diagnostics.typedUnpacks).toBe(0);
            expect(diagnostics.cellsComputed).toBe(0);
            expect(ownedStorage.get(result)!.booleans).toBeDefined();
        } finally { runtime.dispose(); }
    });

    for (const compilation of [false, true]) it(`preserves snapshots, shapes, broadcast and indices (compiled=${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            expect(formatValue(runtime.execute(`use sequences
Reach = array shape 16 fill false
Reach 0 = true
for W in array 3 5 7
  Reach = (Reach or (Reach W shift with false)) copy
end
Reach 0 = false
Reach indices`)!)).toBe('3 5 7 8 10 12 15');
            expect(formatValue(runtime.execute(`Grid = array shape 2 33 fill false
Grid 1 32 = true
Grid indices`)!)).toBe('1 32');
            expect(formatValue(runtime.execute(`Rows = array shape 2 1 fill true
Cols = array true false true
(Rows and Cols) count`)!)).toBe('4');
            expect(formatValue(runtime.execute(`A = array shape 33 fill false
A 0 = true
Saved = (A 1 shift with false) copy
A 0 = false
Saved indices`)!)).toBe('1');
            expect(formatValue(runtime.execute(`A = array shape 33 fill false
A 0 = true
M' = A or (A 1 shift with false)
M count`)!)).toBe('2');
            expect(() => runtime.execute('M 0 = false')).toThrow();
            expect(() => runtime.execute(`Guard = array shape 33 fill false
ReadOnly' = Guard or (Guard 1 shift with false)
Guard 0 = true`)).toThrow(/read-only/);
            expect(formatValue(runtime.execute(`Grid = array shape 2 3 fill true
(Grid 1 shift with false axis 1) count`)!)).toBe('4');
        } finally { runtime.dispose(); }
    });
});

describe('packed boolean problem demonstrations', () => {
    const demo = readFileSync(new URL('../../../demos/cses/advanced/004_cornercount.ra', import.meta.url), 'utf8');
    const definition = demo.slice(demo.indexOf('fun Grid corner_count'));
    for (const compilation of [false, true]) for (const size of [1, 2, 5, 31, 32, 33, 65]) {
        it(`matches a cell-by-cell oracle for a ${size} square (compiled=${compilation})`, () => {
            let seed = 394;
            const cells = Array.from({ length: size * size }, () => {
                seed = Math.imul(seed, 1664525) + 1013904223 | 0;
                return (seed >>> 24) < 173;
            });
            let expected = 0n;
            for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) {
                let common = 0n;
                for (let k = 0; k < size; k++) if (cells[i * size + k] && cells[j * size + k]) common++;
                expected += common * (common - 1n) / 2n;
            }
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.variables.set('Grid', ownedArray(cells, [size, size]));
                expect(runtime.execute('use sequences\n' + definition + '\nGrid corner_count')).toBe(expected);
            } finally { runtime.dispose(); }
        });
    }
});
