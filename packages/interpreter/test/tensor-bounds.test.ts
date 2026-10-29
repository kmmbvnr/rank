import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse, type RankArray, type RankValue } from '../src/index.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { ownedStorage } from '../src/array-storage-state.js';
import { writeArrayCell } from '../src/owned-array.js';

const size = 5000;
describe('bounded homogeneous tensor arithmetic', () => {
    it.each(['float64', 'int32', 'int64'])('emits a direct %s update and reuses storage', kind => {
        const values = new Map<string, RankValue>();
        const make = () => kind === 'float64' ? new Float64Array(size).fill(2)
            : kind === 'int32' ? new Int32Array(size).fill(2) : new BigInt64Array(size).fill(10000000000n);
        const initial = make();
        values.set('A', typedArray(initial)); values.set('B', typedArray(make()));
        ownedStorage.get(values.get('A') as RankArray)!.owners = 1;
        const kernel = compileTensorKernel(parse('A += B * 2 + 1').statements[0], {
            lookup: name => values.get(name), builtin: () => true,
        })!;
        const diagnostics = new RuntimeDiagnostics();
        const result = diagnostics.run(() => kernel.run()) as RankArray;
        expect(kernel.source).toContain('bounded tensor');
        expect(kernel.source).not.toMatch(/typeof|Number\.isFinite|Number\.isSafeInteger|answer\.set/);
        expect(ownedStorage.get(result)!.typed).toBe(initial);
        expect(diagnostics.reusedTensorBuffers).toBe(1);
        expect(readArrayItem(result, size - 1)).toBe(kind === 'float64' ? 7 : kind === 'int32' ? 7n : 30000000001n);
    });

    it('widens int32 output without narrowing an exact result', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new Int32Array(size).fill(2147483647)));
            runtime.execute('A += A * 2');
            const result = runtime.variables.get('A') as RankArray;
            expect(ownedStorage.get(result)!.typed).toBeInstanceOf(BigInt64Array);
            expect(readArrayItem(result, size - 1)).toBe(6442450941n);
        } finally { runtime.dispose(); }
    });

    it('keeps unsafe integer intermediates exact when the final result fits int64', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new BigInt64Array(size).fill(9007199254740991n)));
            runtime.execute('Result = (A * 3 - A * 2) copy');
            expect(readArrayItem(runtime.variables.get('Result') as RankArray, size - 1)).toBe(9007199254740991n);
        } finally { runtime.dispose(); }
    });

    it.each([Infinity, NaN, Number.MAX_VALUE])('invalidates cached ranges after a write of %s', value => {
        const run = (tensorFusion: boolean) => {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                runtime.execute('use sequences');
                runtime.variables.set('A', typedArray(new Float64Array(size).fill(1)));
                runtime.variables.set('B', typedArray(new Float64Array(size).fill(2)));
                runtime.execute('A += B * 2.0');
                writeArrayCell(runtime.variables.get('B') as RankArray, size - 1, value);
                let error: string | undefined;
                try { runtime.execute('A += B * 2.0'); } catch (e) { error = String(e); }
                const a = runtime.variables.get('A') as RankArray;
                return { error, first: readArrayItem(a, 0), last: readArrayItem(a, size - 1) };
            } finally { runtime.dispose(); }
        };
        expect(run(true)).toEqual(run(false));
    });

    it('refreshes scalar proofs and retains aliases across iterative matrix updates', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new Float64Array(size).fill(1), [50, 100]));
            runtime.variables.set('B', typedArray(new Float64Array(size).fill(2), [50, 100]));
            runtime.execute('Rate = 0.5\nA += B * Rate\nSaved = A\nRate = 1.5\nA += B * Rate');
            expect(runtime.execute('A sum')).toBe(25000);
            expect(runtime.execute('Saved sum')).toBe(10000);
        } finally { runtime.dispose(); }
    });
    it('retains bounds across iterations and rescans only a changed input', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new Float64Array(size).fill(1)));
            runtime.variables.set('B', typedArray(new Int32Array(size).fill(2)));
            runtime.execute('A += B * 0.5');
            const warm = new RuntimeDiagnostics();
            warm.run(() => runtime.execute('for N in 1 to 10\n A += B * 0.5\nend'));
            expect(warm.tensorRangeScans).toBe(0);
            expect(warm.reusedTensorBuffers).toBe(10);
            writeArrayCell(runtime.variables.get('B') as RankArray, 0, 4n);
            const changed = new RuntimeDiagnostics();
            changed.run(() => runtime.execute('A += B * 0.5'));
            expect(changed.tensorRangeScans).toBe(1);
            expect(changed.tensorRangeScannedCells).toBe(size);
            expect(runtime.execute('A 0')).toBe(14);
        } finally { runtime.dispose(); }
    });

    it.each(['+', '-', '*', '/'])('matches the reference for signed real %s chains', op => {
        const run = (tensorFusion: boolean) => {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                runtime.execute('use sequences');
                runtime.variables.set('A', typedArray(Float64Array.from({ length: size }, (_, i) => (i % 71 - 35) * 0.25)));
                runtime.variables.set('B', typedArray(Float64Array.from({ length: size }, (_, i) => -(i % 19 + 1) * 0.5)));
                const result = runtime.execute(`Result = ((A ${op} B) * -0.25 + A) copy`) as RankArray;
                return Array.from({ length: size }, (_, i) => readArrayItem(result, i));
            } finally { runtime.dispose(); }
        };
        expect(run(true)).toEqual(run(false));
    });

    it.each([(1n << 63n) - 1n, -(1n << 63n)])('keeps exact wide int64 input %s', value => {
        const values = new Map<string, RankValue>([['A', typedArray(new BigInt64Array(size).fill(value))]]);
        const kernel = compileTensorKernel(parse('Result = (A + 0) copy').statements[0], {
            lookup: name => values.get(name), builtin: () => true,
        })!;
        const result = kernel.run() as RankArray;
        expect(kernel.source).toContain('bounded tensor');
        expect(kernel.source).not.toContain('Number(');
        expect(readArrayItem(result, size - 1)).toBe(value);
    });

    it('declines int64 output overflow without wrapping the mathematical integer', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            const max = (1n << 63n) - 1n;
            runtime.variables.set('A', typedArray(new BigInt64Array(size).fill(max)));
            runtime.execute('A += 1');
            expect(readArrayItem(runtime.variables.get('A') as RankArray, 0)).toBe(max + 1n);
            expect(readArrayItem(runtime.variables.get('A') as RankArray, size - 1)).toBe(max + 1n);
        } finally { runtime.dispose(); }
    });

    it('keeps a failed division assignment atomic after a successful bounded call', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new Float64Array(size).fill(1)));
            runtime.variables.set('B', typedArray(new Float64Array(size).fill(2)));
            runtime.execute('A = (A / B) copy');
            // Rebind to a fresh typed buffer, testing cached input/layout rejection.
            const divisor = new Float64Array(size).fill(2);
            divisor[size - 1] = 0;
            runtime.variables.set('B', typedArray(divisor));
            expect(() => runtime.execute('A = (A / B) copy')).toThrow(/zero/);
            expect(runtime.execute('A 0')).toBe(0.5);
            expect(runtime.execute(`A ${size - 1}`)).toBe(0.5);
        } finally { runtime.dispose(); }
    });

    it.each(['', ' + 0.0'])('does not round wide integer intermediates before cancellation%s', suffix => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new Int32Array(size).fill(2147483647)));
            runtime.execute(`Result = (A * A - (A - 1) * (A + 1)${suffix}) copy`);
            expect(readArrayItem(runtime.variables.get('Result') as RankArray, size - 1)).toBe(suffix ? 1 : 1n);
        } finally { runtime.dispose(); }
    });

    it.each(['(A * -1) / 1.0', '(-A) / 1.0', 'A / -1.0'])('preserves the sign of real zero in %s', expression => {
        const run = (tensorFusion: boolean) => {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                runtime.execute('use sequences');
                runtime.variables.set('A', typedArray(new Int32Array(size)));
                return readArrayItem(runtime.execute(`Result = (${expression}) copy`) as RankArray, 0);
            } finally { runtime.dispose(); }
        };
        expect(Object.is(run(true), run(false))).toBe(true);
    });

    it('does not round wide integer operands before their small difference is promoted', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new BigInt64Array(size).fill(9007199254740993n)));
            runtime.variables.set('B', typedArray(new BigInt64Array(size).fill(9007199254740992n)));
            runtime.execute('Result = (A - B + 0.0) copy');
            expect(readArrayItem(runtime.variables.get('Result') as RankArray, size - 1)).toBe(1);
        } finally { runtime.dispose(); }
    });

    it.each(['int32', 'int64'])('matches exact signed %s matrix arithmetic across interval extremes', kind => {
        const values = new Map<string, RankValue>();
        const a = Array.from({ length: size }, (_, i) => BigInt(i % 257 - 128) * (kind === 'int64' ? 1000000000000000n : 1n));
        const b = Array.from({ length: size }, (_, i) => BigInt(i % 7 - 3));
        values.set('A', typedArray(kind === 'int64' ? BigInt64Array.from(a) : Int32Array.from(a, Number), [50, 100]));
        values.set('B', typedArray(kind === 'int64' ? BigInt64Array.from(b) : Int32Array.from(b, Number), [50, 100]));
        const kernel = compileTensorKernel(parse('Result = (A * B + A - B) copy').statements[0], {
            lookup: name => values.get(name), builtin: () => true,
        })!;
        const result = kernel.run() as RankArray;
        expect(kernel.source).toContain('bounded tensor');
        expect(Array.from({ length: size }, (_, i) => readArrayItem(result, i)))
            .toEqual(a.map((value, i) => value * b[i] + value - b[i]));
    });

    it('keys integer zero normalization by changing scalar primitive types', () => {
        const values = new Map<string, RankValue>([['A', typedArray(new Float64Array(size).fill(-0))]]);
        const kernel = compileTensorKernel(parse('Result = (A + B * C) copy').statements[0], {
            lookup: name => values.get(name), builtin: () => true,
        })!;
        for (let repeat = 0; repeat < 2; repeat++) {
            for (const integer of [true, false]) {
                values.set('B', integer ? -1n : -1);
                values.set('C', integer ? 0n : 0);
                const result = kernel.run() as RankArray;
                expect(Object.is(readArrayItem(result, 0), integer ? 0 : -0)).toBe(true);
            }
        }
    });

    it('rechecks storage after a compilation observer materializes an input', () => {
        const values = new Map<string, RankValue>([['A', typedArray(new Float64Array(size).fill(2))]]);
        const a = values.get('A') as RankArray;
        ownedStorage.get(a)!.owners = 1;
        const kernel = compileTensorKernel(parse('A += 1.0').statements[0], {
            lookup: name => values.get(name), builtin: () => true,
            compiled: source => { if (source.includes('bounded tensor')) void a.items; },
        })!;
        const result = kernel.run() as RankArray;
        expect(readArrayItem(result, 0)).toBe(3);
        expect(readArrayItem(a, 0)).toBe(2);
    });

});
