import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankArray } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';

function execute(source: string, compilation: boolean) {
    const runtime = new Interpreter(undefined, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute('use sequences\n' + source));
        return { value: formatValue(value!), diagnostics };
    } finally { runtime.dispose(); }
}

describe('reusable native boolean axis folds', () => {
    it.each(['all', 'any'])('prepares one graph for all %s cells and repeated mask reads', operation => {
        const source = `A = (1 to 180) reshape 20 9
Want = 1 to 9 array
Mask' = (A equal Want) ${operation} axis 1
Before = Mask copy
After = Mask copy
After`;
        const reference = execute(source, false);
        const compiled = execute(source, true);
        expect(compiled.value).toBe(reference.value);
        expect(compiled.diagnostics.tensorMapPreparations).toBe(2);
        expect(compiled.diagnostics.compiledTensors).toBeGreaterThanOrEqual(40);
    });

    it.each(['all', 'any'])('refreshes a graph after lazy contract refinement for %s', operation => {
        const source = `Sorted = 1 to 1000 array
Pos = (0 to 12 array) reshape 1 13
Pw = 10 ** Pos
Rows = Sorted len
Col' = Sorted reshape Rows 1
Win' = Col // Pw mod 1000
Has' = (Win equal 200) ${operation} axis 1
Has copy`;
        const compiled = execute(source, true);
        expect(compiled.value).toBe(execute(source, false).value);
        expect(compiled.diagnostics.tensorMapPreparations).toBe(2);
        expect(compiled.diagnostics.fallbacks['tensor:stale-input']).toBe(1);
    });

    it.each(['all', 'any'])('keeps captured sources read-only after refreshing %s', operation => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.execute(`use sequences
Sorted = 1 to 1000 array
Pos = (0 to 12 array) reshape 1 13
Pw = 10 ** Pos
Col' = Sorted reshape 1000 1
Mask' = ((Col // Pw mod 1000) equal 200) ${operation} axis 1
Before = Mask copy`);
                const before = formatValue(runtime.variables.get('Before')!);
                expect(() => runtime.execute('Sorted 199 = 999')).toThrow('read-only');
                expect(formatValue(runtime.execute('Mask copy')!)).toBe(before);
            } finally { runtime.dispose(); }
        }
    });

    it.each([false, true])('keeps later-row errors after contract refinement (compilation=%s)', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
A = (array 1 0) reshape 2 1
Pw = (array 1 10) reshape 1 2
Col' = A reshape 2 1
Mask' = ((1 // (Col // Pw)) equal 1) any axis 1`);
            expect(runtime.execute('Mask first')).toBe(true);
            expect(() => runtime.execute('Before = 7\nFailed = Mask copy\nAfter = 9')).toThrow();
            expect(runtime.variables.get('Before')).toBe(7n);
            expect(runtime.variables.has('Failed')).toBe(false);
            expect(runtime.variables.has('After')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it.each(['all', 'any'])('handles empty %s cells and empty frames', operation => {
        for (const shape of ['3 0', '0 3']) {
            const source = `A = array shape ${shape} fill 1
Mask' = (A equal 1) ${operation} axis 1
Mask copy`;
            expect(execute(source, true).value).toBe(execute(source, false).value);
        }
    });

    it.each(['all', 'any'])('routes broadcasts and trailing multiple axes for %s', operation => {
        const source = `A = (1 to 24) reshape 2 3 4
Want = (1 to 12) reshape 3 4
Mask' = (A equal Want) ${operation} axis 1 2
Mask copy`;
        expect(execute(source, true).value).toBe(execute(source, false).value);
    });

    it.each(['all', 'any'])('keeps noncontiguous %s axes on their ordinary path', operation => {
        const source = `A = (1 to 24) reshape 2 3 4
Mask' = (A greater 9) ${operation} axis 0 2
Mask copy`;
        expect(execute(source, true).value).toBe(execute(source, false).value);
    });

    it.each([false, true])('keeps host reads and short circuit order (compilation=%s)', compilation => {
        for (const operation of ['all', 'any']) {
            const reads: number[] = [];
            const host: RankArray = { kind: 'array', shape: [2, 3], items: [], itemAt: index => {
                reads.push(index);
                if (index % 3 !== 0) throw new Error('read after decisive cell');
                return operation === 'all' ? 0n : 1n;
            } };
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.variables.set('Host', host);
                runtime.execute(`use sequences\nLater' = (Host equal 1) ${operation} axis 1`);
                expect(reads).toEqual([]);
                expect(formatValue(runtime.execute('Later copy')!)).toBe(operation === 'all' ? 'false false' : 'true true');
                expect(reads.every(index => index === 0 || index === 3)).toBe(true);
                expect(reads).toContain(3);
            } finally { runtime.dispose(); }
        }
    });

    it.each([false, true])('defers later-row division errors until that row is consumed (compilation=%s)', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
A = (array 1 0 0 1) reshape 2 2
Later' = ((1 // A) equal 1) any axis 1`);
            expect(runtime.variables.has('Later')).toBe(true);
            expect(runtime.execute('Later first')).toBe(true);
            // The second row fails before its later true cell.
            expect(() => runtime.execute('Before = 7\nFailed = Later\nAfter = 9')).toThrow();
            expect(runtime.variables.get('Before')).toBe(7n);
            expect(runtime.variables.has('Failed')).toBe(false);
            expect(runtime.variables.has('After')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it.each([false, true])('keeps completed masks independent of later mutation (compilation=%s)', compilation => {
        const source = `A = array shape 2 3 fill 1
Later' = (A equal 1) all axis 1
Saved = Later
Saved 0 = false
Again = Later
Again`;
        expect(execute(source, compilation).value).toBe('true true');
    });
});
