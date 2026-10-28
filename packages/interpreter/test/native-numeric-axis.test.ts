import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction, isRankArray } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

function execute(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(`use sequences\nuse stats\n${source}`));
        return { value: formatValue(value!), diagnostics };
    } finally { runtime.dispose(); }
}

describe('reusable native numeric axis folds', () => {
    it.each(['sum', 'mean', 'min', 'max', 'count'])('prepares one %s graph per demand across narrow and wide cells', operation => {
        for (const width of [4, 257]) {
            const source = `A = (1 to ${width * 20}) reshape 20 ${width}
Mapped' = (A + 1) ${operation === 'count' ? 'greater 10' : '* 2'}
Rows' = Mapped ${operation} axis 1
Before = Rows
After = Rows
After`;
            const compiled = execute(source, true);
            expect(compiled.value).toBe(execute(source, false).value);
            expect(compiled.diagnostics.tensorMapPreparations).toBe(2);
            expect(compiled.diagnostics.compiledTensors).toBeGreaterThanOrEqual(40);
        }
    });

    it.each(['0', '1', '2', '0 2', '2 0', '1 2'])('routes source axes %s without preparing each result again', axes => {
        const source = `A = (1 to 120) reshape 4 5 6
Mapped' = A * 3 + 1
Rows' = Mapped sum axis ${axes}
Rows copy`;
        const compiled = execute(source, true);
        expect(compiled.value).toBe(execute(source, false).value);
        expect(compiled.diagnostics.tensorMapPreparations).toBe(1);
    });

    it.each([false, true])('retains natural axis traversal and real rounding (compilation=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('A', typedArray(new Float64Array([1e16, 1, 3, 4, -1e16, 2, 5, 6]), [2, 2, 2]));
        try {
            runtime.execute("use sequences\nMapped' = A + 0.0");
            for (const axes of ['0 2', '2 0']) {
                const value = runtime.execute(`Mapped sum axis ${axes} copy`)!;
                expect(isRankArray(value) && value.items).toEqual([2, 18]);
            }
        } finally { runtime.dispose(); }
    });

    it('keeps arbitrary precision without a Number accumulator', () => {
        const source = `A = (array 9007199254740993 2 9007199254740995 4) reshape 2 2
Mapped' = A + 1
Rows' = Mapped sum axis 0
Rows copy`;
        const compiled = execute(source, true);
        expect(compiled.value).toBe('18014398509481990 8');
        expect(compiled.value).toBe(execute(source, false).value);
        expect(compiled.diagnostics.tensorMapPreparations).toBe(1);
    });

    it.each(['sum', 'mean', 'min', 'max', 'count'])('keeps empty %s behavior', operation => {
        for (const shape of ['3 0', '0 3']) {
            const source = `A = array shape ${shape} fill 1
Mapped' = A ${operation === 'count' ? 'greater 0' : '+ 1'}
Rows' = Mapped ${operation} axis 1
Rows copy`;
            const observe = (compilation: boolean) => {
                try { return execute(source, compilation).value; }
                catch (error) { return String(error); }
            };
            expect(observe(true)).toBe(observe(false));
        }
    });

    it.each([false, true])('does not evaluate unused rows or retain results (compilation=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`use sequences
A = (array 1 2 0 4) reshape 2 2
Mapped' = 12 // A
Rows' = Mapped sum axis 1`);
            expect(runtime.execute('Rows first')).toBe(18n);
            expect(runtime.execute('Rows first')).toBe(18n);
            expect(() => runtime.execute('Before = 7\nFailed = Rows\nAfter = 9')).toThrow('division by zero');
            expect(runtime.variables.get('Before')).toBe(7n);
            expect(runtime.variables.has('Failed')).toBe(false);
            expect(runtime.variables.has('After')).toBe(false);
            expect(runtime.execute('Rows first')).toBe(18n);
        } finally { runtime.dispose(); }
    });

    it('refreshes once after lazy shape-contract refinement', () => {
        const source = `A = 1 to 1000 array
Columns' = A reshape 100 10
Rows' = (Columns + 1) sum axis 1
Rows copy`;
        const compiled = execute(source, true);
        expect(compiled.value).toBe(execute(source, false).value);
        expect(compiled.diagnostics.tensorMapPreparations).toBeLessThanOrEqual(2);
    });

    it('checks the native reducer again between frame cells', () => {
        let entries = 0;
        const runtime = new Interpreter(() => {}, { onTensorKernelExecuted() {
            entries++;
            const reducer = runtime.variables.get('sum');
            if (reducer && isNativeFunction(reducer)) Object.defineProperty(reducer, 'call', { value: () => 77n });
        } });
        try {
            runtime.execute("use sequences\nA = (array 1 2 3 4) reshape 2 2\nMapped' = A + 1\nRows' = Mapped sum axis 1");
            const reducer = runtime.execute('sum')!;
            expect(isNativeFunction(reducer)).toBe(true);
            // Module imports are resolved through the interpreter, not variables.
            if (!isNativeFunction(reducer)) throw Error('expected sum');
            runtime.variables.set('sum', reducer);
            const value = runtime.execute('Rows copy')!;
            expect(isRankArray(value) && value.items).toEqual([5n, 77n]);
            expect(entries).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('declines host readers without probing, preserving frame and cell read order', () => {
        for (const compilation of [false, true]) {
            const reads: number[] = [];
            const runtime = new Interpreter(() => {}, { compilation });
            runtime.variables.set('Host', { kind: 'array', shape: [2, 3], items: [], containsFiles: false,
                itemAt: index => { reads.push(index); return BigInt(index + 1); } });
            try {
                runtime.execute("use sequences\nMapped' = Host + 1\nRows' = Mapped sum axis 0");
                expect(reads).toEqual([]);
                expect(formatValue(runtime.execute('Rows copy')!)).toBe('7 9 11');
                expect(reads).toEqual([0, 3, 1, 4, 2, 5]);
            } finally { runtime.dispose(); }
        }
    });

    it('observes source replacement by the compilation observer', () => {
        const source = ownedArray([1n, 2n, 3n, 4n], [2, 2]);
        const reads: number[] = [];
        const runtime = new Interpreter(() => {}, { onTensorKernelCompiled() {
            Object.defineProperty(source, 'itemAt', { configurable: true, value: (index: number) => {
                reads.push(index); return 7n;
            } });
        } });
        runtime.variables.set('A', source);
        try {
            runtime.execute("use sequences\nMapped' = A + 1\nRows' = Mapped sum axis 0");
            expect(formatValue(runtime.execute('Rows copy')!)).toBe('16 16');
            expect(reads).toEqual([0, 2, 1, 3]);
        } finally { runtime.dispose(); }
    });

    it('polls cancellation inside the reused fold without publishing a partial result', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const runtime = new Interpreter(() => {}, { onTensorKernelCompiled(source) {
            if (source.includes('tensor:axis-frame')) Atomics.store(signal, 0, 1);
        } });
        try {
            runtime.execute("use sequences\nA = (1 to 40000) reshape 2 20000\nMapped' = A + 1\nRows' = Mapped sum axis 1\nBefore = 7");
            expect(() => withInterrupt(signal, () => runtime.execute('Failed = Rows\nAfter = 9'))).toThrow(InterruptedError);
            expect(runtime.variables.get('Before')).toBe(7n);
            expect(runtime.variables.has('Failed')).toBe(false);
            expect(runtime.variables.has('After')).toBe(false);
            Atomics.store(signal, 0, 0);
        } finally { runtime.dispose(); }
    });
});
