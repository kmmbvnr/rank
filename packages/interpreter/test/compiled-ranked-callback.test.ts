import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, isRankArray, type RankValue } from '../src/index.js';
import { MissingValueError } from '../src/errors.js';
import { MISSING } from '../src/value.js';
import { native } from '../src/modules/shared.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

function scenario(compiled: boolean, body: string, values: RankValue[],
    read: (index: number, runtime: Interpreter) => void = () => {},
    consume: (runtime: Interpreter) => unknown = runtime => {
        const mapped = runtime.variables.get('Mapped');
        if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
        return [...mapped.items];
    }) {
    const reads: number[] = [];
    let kernels = 0;
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled,
        onScalarFunctionExecuted: () => kernels++ });
    try {
        runtime.execute(`use sequences\nuse text\nfun helper X\n${body}\nend`);
        runtime.variables.set('Source', { kind: 'array', shape: [values.length], containsFiles: false,
            items: [], itemAt: index => { reads.push(index); read(index, runtime); return values[index]; } });
        const diagnostics = new RuntimeDiagnostics();
        const { before, value } = diagnostics.run(() => {
            runtime.execute('Mapped = Source helper rank 0');
            const before = [...reads];
            return { before, value: consume(runtime) };
        });
        return { value, reads, before, kernels, batches: diagnostics.rankedBatches };
    } finally { runtime.dispose(); }
}

function compare(body: string, values: RankValue[], read?: Parameters<typeof scenario>[3], consume?: Parameters<typeof scenario>[4]) {
    const reference = scenario(false, body, values, read, consume);
    const compiled = scenario(true, body, values, read, consume);
    expect({ ...compiled, kernels: 0, batches: 0 }).toEqual({ ...reference, kernels: 0, batches: 0 });
    return compiled;
}

describe('compiled ranked callbacks', () => {
    it('retains partial read order and materializes each remaining cell once', () => {
        const result = compare('return X * 2', [1n, 2n, 3n, 4n], undefined, runtime => {
            expect(runtime.execute('Mapped 2')).toBe(6n);
            const mapped = runtime.variables.get('Mapped');
            if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
            const first = mapped.items;
            expect(mapped.items).toEqual(first);
            expect(runtime.execute('Mapped 2')).toBe(6n);
            return [...first];
        });
        expect(result.value).toEqual([2n, 4n, 6n, 8n]);
        expect(result.before).toEqual([0]);
        expect(result.reads).toEqual([0, 2, 1, 3]);
        expect(result.kernels).toBe(4);
        expect(result.batches).toBeGreaterThan(0);
    });

    it('uses already-read operands when a native binding changes between cells', () => {
        const result = compare('return X text reverse', [12n, 13n, 14n, 15n], (index, runtime) => {
            if (index === 2) runtime.variables.set('reverse', native('replacement', 1, ([value]) => `changed:${value}`));
        });
        expect(result.value).toEqual(['21', '31', 'changed:14', 'changed:15']);
        expect(result.reads).toEqual([0, 1, 2, 3]);
        expect(result.kernels).toBe(2);
    });

    it('retains successful cells after failure and retries only the failing cell', () => {
        const result = compare('return X character', [65n, 66n, -1n, 67n], undefined, runtime => {
            const mapped = runtime.variables.get('Mapped');
            if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
            const errors: string[] = [];
            for (let attempt = 0; attempt < 2; attempt++) {
                try { void mapped.items; throw new Error('expected character failure'); }
                catch (error) {
                    if (!(error instanceof RankError)) throw error;
                    errors.push(error.format());
                }
            }
            return errors;
        });
        expect(result.reads).toEqual([0, 1, 2, 2]);
        expect(result.kernels).toBe(4);
        expect(result.batches).toBeGreaterThan(0);
    });

    it.each([false, true])('checks a refined binding before reading another cell (compiled=%s)', compiled => {
        const reads: number[] = [];
        const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
        try {
            runtime.execute('Mapped = array 1 2 3\nfun helper X\nreturn X text\nend');
            runtime.variables.set('Source', { kind: 'array', shape: [3], containsFiles: false, items: [],
                itemAt: index => { reads.push(index); return BigInt(index); } });
            runtime.execute('Mapped = Source helper rank 0');
            const mapped = runtime.variables.get('Mapped');
            if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
            expect(() => mapped.items).toThrow(/Mapped/);
            expect(reads).toEqual([0]);
        } finally { runtime.dispose(); }
    });

    it.each([false, true])('preserves soft missing-cell behavior through a binding=%s', bound => {
        const outcomes = [false, true].map(compiled => {
            const reads: number[] = [];
            const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
            try {
                runtime.execute('fun helper X\nreturn X * 2\nend');
                runtime.variables.set('Source', { kind: 'array', shape: [3], containsFiles: false, items: [],
                    itemAt: index => {
                        reads.push(index);
                        if (index === 1) throw new MissingValueError('missing source cell', true);
                        return BigInt(index + 1);
                    } });
                const value = runtime.execute(`${bound ? 'Mapped = ' : ''}Source helper rank 0`);
                const mapped = bound ? runtime.variables.get('Mapped') : value;
                if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
                try { return { value: [...mapped.items], reads }; }
                catch (error) {
                    if (!(error instanceof RankError)) throw error;
                    return { error: error.format(), reads };
                }
            } finally { runtime.dispose(); }
        });
        expect(outcomes[1]).toEqual(outcomes[0]);
        if (bound) expect(outcomes[1].value).toEqual([2n, MISSING, 6n]);
        else expect(outcomes[1].error).toContain('missing source cell');
    });

    it('does not run a callback for an empty frame', () => {
        const result = compare('return X * 2', []);
        expect(result.reads).toEqual([]);
        expect(result.value).toEqual([]);
        expect(result.kernels).toBe(0);
    });

    it('keeps memo callbacks behind their memo wrapper', () => {
        let kernels = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => kernels++ });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const result = diagnostics.run(() => {
                runtime.execute('memo helper X\nreturn X * 2\nend');
                const mapped = runtime.execute('(array 1 1 2 1) helper rank 0');
                if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
                return [...mapped.items];
            });
            expect(result).toEqual([2n, 2n, 4n, 2n]);
            expect(kernels).toBe(2);
            expect(diagnostics.rankedBatches).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('keeps inspection on the ordinary callback path for unread cells', () => {
        const result = scenario(true, 'return X * 2', [1n, 2n, 3n], undefined, runtime => {
            const mapped = runtime.variables.get('Mapped');
            if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
            return withInterrupt(new Int32Array(new SharedArrayBuffer(4)), () => [...mapped.items], () => {});
        });
        expect(result.value).toEqual([2n, 4n, 6n]);
        expect(result.kernels).toBe(1); // Shape discovery preceded inspection.
    });

    it.each([false, true])('interrupts full materialization with compilation %s', compiled => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        let reads = 0;
        expect(() => scenario(compiled, 'return X * 2', Array<RankValue>(10000).fill(1n), () => {
            if (++reads === 1500) Atomics.store(signal, 0, 1);
        }, runtime => {
            const mapped = runtime.variables.get('Mapped');
            if (!mapped || !isRankArray(mapped)) throw new Error('missing mapped array');
            return withInterrupt(signal, () => mapped.items);
        })).toThrow(InterruptedError);
        expect(reads).toBeLessThan(4096);
    });
});
