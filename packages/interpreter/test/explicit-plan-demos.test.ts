import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, demand, formatValue, isRankPlan, isNativeFunction, type RankArray } from '../src/index.js';
import { windowValue } from '../src/sequence.js';
import { isStoredValue } from '../src/stored-value.js';
import { runExecution } from '../src/execution.js';
import { denseScalarItems, materializedArrayItems } from '../src/array-storage.js';

const euler4 = readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8');
const covariance = readFileSync(new URL('../../../demos/deepml/010_cov.ra', import.meta.url), 'utf8');
const windows = readFileSync(new URL('../../../demos/classic/windows.ra', import.meta.url), 'utf8');

describe.each([false, true])('explicit-plan demo migration (compilation=%s)', compilation => {
    it.each([
        ['005_smallestmultiple', 20, 232792560n],
        ['006_sumsquarediff', 10000, (10000n * 10001n / 2n) ** 2n - 10000n * 10001n * 20001n / 6n],
    ] as const)('streams Euler %s at limit %s', (name, limit, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected);
            expect(isStoredValue(runtime.variables.get('Range')!)).toBe(false);
            if (name === '006_sumsquarediff') expect(isStoredValue(runtime.variables.get('Squares')!)).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('keeps Euler 11 windows deferred through its helper parameter', () => {
        const source = readFileSync(new URL('../../../demos/euler/011_gridproduct.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences');
            runtime.declareFunctionSource(source);
            const fn = runtime.variables.get('products')!;
            if (!isNativeFunction(fn)) throw new Error('expected products function');
            const input: RankArray = { kind: 'array', items: [1n, 2n, 3n, 4n], shape: [4] };
            const view = windowValue(input, 2n);
            const result = diagnostics.run(() => fn.call([view]));
            expect(diagnostics.cellsComputed).toBe(0);
            if (!isRankPlan(result)) throw new Error('expected a deferred reduction');
            const windows = result.dependencies.get('Windows')!;
            expect(windows).toMatchObject({ kind: 'array', shape: [3, 2] });
            expect(isStoredValue(windows)).toBe(false);
            expect(runExecution(demand(result))).toBe(12n);
            expect(runExecution(demand(result))).toBe(12n);
        } finally { runtime.dispose(); }
    });

    it('retains the single-pass Fibonacci generator for both consumers', () => {
        const source = readFileSync(new URL('../../../demos/euler/002_evenfib.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(4613732n);
            expect(isStoredValue(runtime.variables.get('Fib')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Mask')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['001_multiples', 1000, 'Mask', 'Mask 0 = true', 233168n],
        ['014_collatz', 14, 'Lengths', 'Lengths 0 = 999', 9n],
    ] as const)('retains writable working data in Euler %s', (name, limit, binding, mutation, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected);
            expect(isStoredValue(runtime.variables.get(binding)!)).toBe(true);
            runtime.executeProgram(runtime.parse(mutation), []);
            expect(runtime.variables.get('Answer')).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('keeps generated-grid windows deferred and materializes an explicit retained result', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(windows));
            expect(output).toEqual(['1 2 4 5 2 3 5 6 4 5 7 8 5 6 8 9', '1 5 9', '3 5 7']);
            const blocks = runtime.variables.get('Blocks')!;
            expect(isRankPlan(blocks)).toBe(true);
            const before = diagnostics.cellsComputed;
            const view = diagnostics.run(() => runExecution(demand(blocks))) as RankArray;
            expect(view.shape).toEqual([2, 2, 2, 2]);
            expect(denseScalarItems(view)).toBeUndefined();
            expect(materializedArrayItems(view)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(before);
            const saved = runtime.execute('Saved = Blocks') as RankArray;
            expect(saved.shape).toEqual([2, 2, 2, 2]);
            expect(denseScalarItems(saved)).toBeDefined();
            expect(formatValue(saved)).toBe(output[0]);
        } finally { runtime.dispose(); }
    });

    it('retains centered data once and defers the covariance transpose', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`${covariance}\nMatrix = array shape 2 3\n1 2 3\n4 5 6\nend\nResult' = Matrix covmatrix`));
            const result = runtime.variables.get('Result')!;
            expect(isRankPlan(result)).toBe(true);
            if (!isRankPlan(result)) throw new Error('expected a covariance plan');
            const centered = result.dependencies.get('Centered') as RankArray;
            expect(centered.shape).toEqual([2, 3]);
            expect(denseScalarItems(centered)).toBeDefined();
            expect(formatValue(centered)).toBe('-1 0 1 -1 0 1');
            const transposed = result.dependencies.get('Transposed')!;
            expect(isRankPlan(transposed)).toBe(true);
            if (!isRankPlan(transposed)) throw new Error('expected a transpose plan');
            expect(transposed.dependencies.get('Centered')).toBe(centered);
            const before = diagnostics.cellsComputed;
            const view = diagnostics.run(() => runExecution(demand(transposed))) as RankArray;
            expect(view.shape).toEqual([3, 2]);
            expect(denseScalarItems(view)).toBeUndefined();
            expect(materializedArrayItems(view)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(before);
            const saved = runtime.execute('Saved = Result') as RankArray;
            expect(saved.shape).toEqual([2, 2]);
            expect(formatValue(saved)).toBe('1 1 1 1');
            expect(denseScalarItems(saved)).toBeDefined();
        } finally { runtime.dispose(); }
    });

    it('finds Euler 4 without completing the product table', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(euler4));
            expect(runtime.variables.get('Answer')).toBe(906609n);
            expect(output).toEqual(['906609']);
            expect(runtime.variables.get('Factors')).toMatchObject({ kind: 'array', shape: [900] });
            const products = runtime.variables.get('Products')!;
            expect(isRankPlan(products)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Candidates')!)).toBe(true);
            // The symbolic outer implementation reports each computed product
            // through derived-array diagnostics. Early search reads a prefix.
            expect(diagnostics.cellsComputed).toBeGreaterThan(0);
            expect(diagnostics.cellsComputed).toBeLessThan(900 * 900);
            const before = diagnostics.cellsComputed;
            const native = diagnostics.run(() => runExecution(demand(products))) as RankArray;
            expect(native.shape).toEqual([900, 900]);
            expect(denseScalarItems(native)).toBeUndefined();
            expect(materializedArrayItems(native)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(before);
        } finally { runtime.dispose(); }
    });
});
