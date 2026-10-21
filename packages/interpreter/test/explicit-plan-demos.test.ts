import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, demand, formatValue, isRankPlan, type RankArray } from '../src/index.js';
import { runExecution } from '../src/execution.js';
import { denseScalarItems, materializedArrayItems } from '../src/array-storage.js';

const euler4 = readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8');
const covariance = readFileSync(new URL('../../../demos/deepml/010_cov.ra', import.meta.url), 'utf8');

describe.each([false, true])('explicit-plan demo migration (compilation=%s)', compilation => {
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
