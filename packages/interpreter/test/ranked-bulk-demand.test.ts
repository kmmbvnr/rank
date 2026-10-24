import { Interpreter } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { materializedArrayItems, ownedArray, readArrayItem } from '../src/array-storage.js';
import { completed, runExecution } from '../src/execution.js';
import { framedArray } from '../src/framed-array.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { standardModules } from '../src/modules/index.js';
import { RankApplication } from '../src/rank-application.js';
import { isRankArray, type NativeFunction, type RankArray, type RankValue } from '../src/value.js';

const size = 2048;
function source(read: (index: number) => RankValue): RankArray {
    return framedArray([size], read, {
        shape: [], ownFiles: () => {}, mismatch: () => Error('unexpected shape'),
    });
}
function setup(scalar?: (args: RankValue[]) => RankValue) {
    const fn = standardModules.core.min({
        output: () => {}, random: () => 0.5, seedRandom: () => {}, ownFile: () => {},
    }) as NativeFunction;
    const app = new RankApplication((operation, args) => completed(operation.call(args)),
        () => {}, new Map([[standardModules.core.min, fn]]), () => scalar);
    return { fn, app, apply(left: RankValue, right: RankValue = 10n): RankArray {
        const value = runExecution(app.applyDyadicAtRank(left, right, fn));
        if (!isRankArray(value)) throw Error('expected array');
        return value;
    } };
}

describe('bulk ranked application demand', () => {
    it('defers lazy operands, reads only selected cells and recomputes on repeat', () => {
        const reads: number[] = [];
        const input = source(index => { reads.push(index); return BigInt(index); });
        const result = setup().apply(input);
        expect(reads).toEqual([]);
        expect(result.shape).toEqual([size]);
        expect(readArrayItem(result, 5)).toBe(5n);
        expect(readArrayItem(result, 5)).toBe(5n);
        expect(reads).toEqual([5, 5]);
    });

    it('keeps left-to-right demand and leaves a later failure unread', () => {
        const reads: string[] = [];
        const left = source(index => {
            reads.push(`L${index}`);
            if (index === 9) throw Error('late input');
            return BigInt(index);
        });
        const right = source(index => { reads.push(`R${index}`); return 10n; });
        const result = setup().apply(left, right);
        expect(reads).toEqual([]);
        expect(readArrayItem(result, 2)).toBe(2n);
        expect(reads).toEqual(['L2', 'R2']);
        expect(() => readArrayItem(result, 9)).toThrow('late input');
        expect(() => readArrayItem(result, 9)).toThrow('late input');
        expect(reads).toEqual(['L2', 'R2', 'L9', 'L9']);
    });

    it('does not probe host items to prove completed storage', () => {
        let reads = 0;
        const input: RankArray = {
            kind: 'array', shape: [size],
            get items(): RankValue[] { throw Error('opaque items'); },
            itemAt(index) { reads++; return BigInt(index); },
        };
        const result = setup().apply(input);
        expect(reads).toBe(0);
        expect(readArrayItem(result, 3)).toBe(3n);
        expect(reads).toBe(1);
    });

    it('retains bulk execution for completed scalar storage', () => {
        const input = ownedArray(Array.from({ length: size }, (_, i) => BigInt(i)));
        const result = setup().apply(input);
        expect(materializedArrayItems(result)).toHaveLength(size);
        expect(readArrayItem(result, size - 1)).toBe(10n);
        expect(readArrayItem(input, size - 1)).toBe(BigInt(size - 1));
    });

    it('does not speculate a replacement call on the same builtin object', () => {
        const runtime = setup();
        let calls = 0;
        Object.defineProperty(runtime.fn, 'call', {
            value: (args: RankValue[]) => { calls++; return args[0]; },
        });
        const result = runtime.apply(ownedArray(Array.from({ length: size }, () => 3n)));
        expect(calls).toBe(0);
        expect(readArrayItem(result, 0)).toBe(3n);
        expect(calls).toBe(1);
    });

    it('propagates cancellation from a compiled bulk callback without fallback', () => {
        let calls = 0;
        const runtime = setup(args => {
            if (++calls === 2) throw new InterruptedError('test callback');
            return args[0];
        });
        expect(() => runtime.apply(ownedArray(Array.from({ length: size }, () => 3))).items)
            .toThrow(InterruptedError);
        expect(calls).toBe(2);
    });

    it('propagates cancellation while inferring an empty frame cell shape', () => {
        const runtime = setup();
        Object.defineProperty(runtime.fn, 'monadicResultShape', { value: undefined });
        const signal = new Int32Array(new SharedArrayBuffer(4));
        signal[0] = 1;
        expect(() => withInterrupt(signal, () => runExecution(runtime.app.applyUnaryAtRank(
            ownedArray([], [0, 2]), runtime.fn, 1)))).toThrow(InterruptedError);
    });

    it('defers execution when host polling can observe intermediate work', () => {
        const signal: InterruptSignal = {
            length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {},
        };
        let calls = 0;
        const runtime = setup(args => { calls++; return args[0]; });
        withInterrupt(signal, () => {
            const result = runtime.apply(ownedArray(Array.from({ length: size }, () => 3n)));
            expect(calls).toBe(0);
            expect(readArrayItem(result, 0)).toBe(3n);
            expect(calls).toBe(1);
        });
    });
});


describe.each([false, true])('large ranked plan (compilation=%s)', compilation => {
    it('evaluates a captured input only on demand and retains ordinary bindings', () => {
        let reads = 0;
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Input', source(index => { reads++; return BigInt(index); }));
            runtime.execute("Plan' = Input min 10");
            expect(reads).toBe(0);
            runtime.execute('Saved = Plan');
            expect(reads).toBe(size);
            runtime.execute('Again = Plan');
            expect(reads).toBe(size * 2);
            expect(runtime.execute('Saved sum')).toBe(20425n);
            expect(reads).toBe(size * 2);
        } finally { runtime.dispose(); }
    });
});
