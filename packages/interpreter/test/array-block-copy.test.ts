import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { eagerOperandItems, integer32Cells, readArrayItem, typedArray, typedElementKind } from '../src/array-storage.js';
import { copyArrayStorage } from '../src/array-copy.js';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';
import { sliceArray, tensorSelection, ALL_AXIS } from '../src/selectors.js';

for (const compilation of [true, false]) describe(`stored block copies (compilation=${compilation})`, () => {
    it('keeps real storage packed through repeated slice copies in a loop', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use sequences\nX = (0 till 20000) copy\nY = X * 1.0\nTotal = 0.0');
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute(`for R in 1 to 4
 A = (Y (10 till 10010)) copy
 Total += A 0 + A 9999
end
Total`));
            expect(result).toBe(40076);
            expect(diagnostics.typedUnpacks).toBe(0);
            expect(diagnostics.cellsComputed).toBe(0);
            expect(diagnostics.elementTypeScannedCells).toBe(0);
            runtime.execute('Y 10 = -1.0');
            expect(runtime.execute('Total')).toBe(40076);
        } finally { runtime.dispose(); }
    });

    it.each(['int32', 'int64', 'real'] as const)('copies row windows directly from %s storage', kind => {
        const runtime = new Interpreter(undefined, { compilation });
        const data = kind === 'int32' ? Int32Array.from({ length: 90000 }, (_, i) => i - 45000)
            : kind === 'int64' ? BigInt64Array.from({ length: 90000 }, (_, i) => (1n << 55n) + BigInt(i))
                : Float64Array.from({ length: 90000 }, (_, i) => i + 0.5);
        runtime.variables.set('M', typedArray(data, [300, 300]));
        try {
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute('S = M (1 till 299) (2 till 297)\nS')) as RankArray;
            expect(result.shape).toEqual([298, 295]);
            expect(typedElementKind(result)).toBe(kind === 'real' ? 'real' : 'integer');
            expect(diagnostics.typedUnpacks).toBe(0);
            expect(diagnostics.cellsComputed).toBe(0);
            if (kind === 'int32') expect(integer32Cells(result)).toBeDefined();
            for (let i = 0; i < 298 * 295; i++) {
                const raw = data[(1 + Math.floor(i / 295)) * 300 + 2 + i % 295];
                expect(readArrayItem(result, i)).toBe(kind === 'int32' ? BigInt(raw) : raw);
            }
            const original = data[302];
            runtime.execute(kind === 'real' ? 'M 1 2 = 7.0\nS 0 1 = 9.0' : 'M 1 2 = 7\nS 0 1 = 9');
            expect(runtime.execute('S 0 0')).toBe(kind === 'int32' ? BigInt(original) : original);
            expect(runtime.execute('M 1 3')).not.toBe(9n);
        } finally { runtime.dispose(); }
    });

    it('copies nonzero-offset vectors, trailing planes and reversed rows correctly', () => {
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('M', typedArray(Int32Array.from({ length: 12000 }, (_, i) => i), [20, 30, 20]));
        try {
            expect(runtime.execute('use sequences\nS = M (3 till 8) # #\nS 0 0 0')).toBe(1800n);
            expect(runtime.execute('S 4 29 19')).toBe(4799n);
            expect(runtime.execute('T = M (8 to 3 by -1) (2 till 7) #\nT 0 0 0')).toBe(4840n);
            expect(runtime.execute('T 5 4 19')).toBe(1939n);
            expect(runtime.execute('V = (0 till 10000) copy\nW = V (100 till 9000)\nW sum')).toBe(40490550n);
            expect(runtime.execute('E = V (0 till 0)\nE sum')).toBe(0n);
        } finally { runtime.dispose(); }
    });
});

for (const compilation of [true, false]) describe(`concat block copies (compilation=${compilation})`, () => {
    it.each([0, 1, 2])('copies tensor blocks along axis %s and isolates later writes', axis => {
        const runtime = new Interpreter(undefined, { compilation });
        const shape = [4, 5, 6], other = [...shape];
        other[axis] = 2;
        const a = Int32Array.from({ length: 120 }, (_, i) => i - 60);
        const b = Int32Array.from({ length: other.reduce((n, size) => n * size, 1) }, (_, i) => i + 500);
        runtime.variables.set('A', typedArray(a, shape));
        runtime.variables.set('B', typedArray(b, other));
        try {
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute(`use sequences\nC = concat A B axis ${axis}\nC`)) as RankArray;
            const expectedShape = [...shape];
            expectedShape[axis] += 2;
            expect(result.shape).toEqual(expectedShape);
            expect(integer32Cells(result)).toBeDefined();
            expect(diagnostics.cellsComputed).toBe(0);
            expect(diagnostics.typedUnpacks).toBe(0);
            for (let i = 0; i < result.shape[0]; i++) for (let j = 0; j < result.shape[1]; j++) for (let k = 0; k < result.shape[2]; k++) {
                const coordinates = [i, j, k];
                const right = coordinates[axis] >= shape[axis];
                if (right) coordinates[axis] -= shape[axis];
                const dims = right ? other : shape;
                const index = (coordinates[0] * dims[1] + coordinates[1]) * dims[2] + coordinates[2];
                const offset = (i * result.shape[1] + j) * result.shape[2] + k;
                expect(readArrayItem(result, offset)).toBe(BigInt((right ? b : a)[index]));
            }
            runtime.execute('A 0 0 0 = 7\nB 0 0 0 = 8');
            expect(runtime.execute('C 0 0 0')).toBe(-60n);
            runtime.execute('C 0 0 0 = 9');
            expect(runtime.execute('A 0 0 0')).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('copies a boxed padding block beside a packed matrix without narrowing integers', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use sequences\nD = array shape 100 100 fill 1\nZ = array shape 100 4 fill -2');
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute('C = concat D Z axis 1\nC')) as RankArray;
            expect(integer32Cells(result)).toBeDefined();
            expect(diagnostics.cellsComputed).toBe(0);
            expect(runtime.execute('C sum')).toBe(9200n);
            expect(runtime.execute('C 0 100')).toBe(-2n);
            expect(runtime.execute('C 99 103')).toBe(-2n);
            runtime.execute('Z 0 0 = 1267650600228229401496703205376');
            expect(runtime.execute('W = concat D Z axis 1\nW 0 100')).toBe(1n << 100n);
            expect(runtime.execute('C 0 100')).toBe(-2n);
        } finally { runtime.dispose(); }
    });

    it('retains empty, mixed storage and arbitrary precision fallbacks', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute('use sequences\nA = array shape 4 0 fill 1\nB = array shape 4 2 fill 3\nC = concat A B axis 1\nC sum')).toBe(24n);
            runtime.variables.set('Packed', typedArray(new BigInt64Array([1n << 55n, 7n]), [1, 2]));
            runtime.variables.set('Compact', typedArray(new Int32Array([3, -4]), [1, 2]));
            expect(runtime.execute('D = concat Packed Compact axis 1\nD sum')).toBe((1n << 55n) + 6n);
            expect(runtime.execute('H = array shape 2 2 fill 1267650600228229401496703205376\n(concat H H axis 1) sum')).toBe(8n * (1n << 100n));
        } finally { runtime.dispose(); }
    });
});

describe('block copy guards', () => {
    it('propagates cancellation while preparing a stored slice for an eager kernel', () => {
        const source = typedArray(new Float64Array(100000).fill(0.5));
        const selected = sliceArray(source, tensorSelection(source, [ALL_AXIS])) as RankArray;
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => eagerOperandItems(selected, true))).toThrow(InterruptedError);
    });

    it('keeps cancellation checkpoints and leaves source storage unchanged', () => {
        const source = typedArray(new Int32Array(100000).fill(2));
        const selected = sliceArray(source, tensorSelection(source, [ALL_AXIS])) as RankArray;
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => copyArrayStorage(selected))).toThrow(InterruptedError);
        expect(readArrayItem(source, 0)).toBe(2n);
        expect(readArrayItem(source, 99999)).toBe(2n);
        expect(copyArrayStorage(selected)).toBeDefined();
    });

    it('does not bypass replaced source or selection readers', () => {
        const source = typedArray(new Int32Array(10000).fill(2), [100, 100]);
        const selected = sliceArray(source, tensorSelection(source, [ALL_AXIS, ALL_AXIS])) as RankArray;
        expect(copyArrayStorage(selected)).toBeDefined();
        Object.defineProperty(source, 'itemAt', { value: () => { throw new Error('source changed'); } });
        expect(copyArrayStorage(selected)).toBeUndefined();
        expect(() => readArrayItem(selected, 0)).toThrow('source changed');
        Object.defineProperty(selected, 'itemAt', { value: () => 7n });
        expect(copyArrayStorage(selected)).toBeUndefined();
    });
});
