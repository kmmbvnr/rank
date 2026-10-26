import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, withDemandBudget, DemandBudgetExhausted } from '../src/index.js';
import { ownedArray, materializedArrayItems, arrayForWrite, noteArrayBinding, writeArrayCell, readArrayItem } from '../src/array-storage.js';
import { demandValue } from '../src/plan.js';
import { sliceArray, tensorSelection } from '../src/selectors.js';
import { sumValue } from '../src/modules/numbers.js';
import { Operators } from '../src/operators.js';
import { registerTensorResult, tensorPlanScope } from '../src/tensor-map.js';
import { compileNativeTensorReduction, type TensorCodeCache, type TensorNode } from '../src/tensor-kernel.js';
import type { RankArray } from '../src/value.js';
import type { CompiledAtomType } from '@arrrank/language';

const cases = [
    { name: 'transpose', body: "View' = Scaled transpose", expected: 42n },
    { name: 'drop', body: "View' = Scaled drop 1", expected: 30n },
    { name: 'take', body: "View' = Scaled take 1", expected: 12n },
    { name: 'duplicate columns', body: "View' = Scaled # (array 2 0 2)", expected: 46n },
    { name: 'duplicate rows', body: "View' = Scaled (array 1 0 1)", expected: 72n },
    { name: 'chained permutation and gather', body: "T' = Scaled transpose\nRows' = T (array 2 0)\nView' = Rows transpose", expected: 28n },
    { name: 'broadcast after transpose', body: "T' = Scaled transpose\nRow = array 10 20\nView' = T + Row", expected: 132n },
] as const;

describe.each([false, true])('checked tensor view composition (compilation=%s)', compilation => {
    function runtime() {
        let entries = 0;
        const sources: string[] = [], output: string[] = [];
        const diagnostics = new RuntimeDiagnostics();
        const host = new Interpreter(text => output.push(text), { compilation,
            onTensorKernelExecuted: () => entries++, onTensorKernelCompiled: source => sources.push(source) });
        host.variables.set('Input', ownedArray([1n, 2n, 3n, 4n, 5n, 6n], [2, 3]));
        return { host, sources, output, diagnostics, entries: () => entries,
            execute: (source: string) => diagnostics.run(() => host.execute(source)) };
    }

    it.each(cases)('fuses $name in one loop without completing intermediate views', ({ body, expected }) => {
        const { host, execute, entries, sources, diagnostics } = runtime();
        try {
            execute(`use sequences\nScaled' = Input * 2\n${body}\nTotal' = View sum`);
            expect(entries()).toBe(0);
            const view = diagnostics.run(() => demandValue(host.variables.get('View')!));
            if (!isRankArray(view)) throw Error('expected view');
            expect(materializedArrayItems(view)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(0);
            expect(execute('Total')).toBe(expected);
            expect(execute('Total')).toBe(expected);
            expect(entries()).toBe(compilation ? 2 : 0);
            if (compilation) {
                expect(sources).toHaveLength(1);
                expect(sources[0].match(/for \(/g)).toHaveLength(1);
                expect(sources[0]).not.toContain('new Array');
                expect(diagnostics.cellsComputed).toBe(0);
            }
        } finally { host.dispose(); }
    });

    it('also compiles views of stored sources and inline consumers after demand', () => {
        const { host, execute, entries } = runtime();
        try {
            execute("use sequences\nView' = Input transpose");
            expect(execute('View sum')).toBe(21n);
            expect(execute('(View + 1) sum')).toBe(27n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('completes an ordinary retained transpose before a writable alias can change it', () => {
        const { host, execute } = runtime();
        try {
            execute("use sequences\nScaled' = Input * 2\nView' = Scaled transpose\nSaved = View\nAlias = Saved\nSaved 0 0 = 99");
            const alias = host.variables.get('Alias')!;
            if (!isRankArray(alias)) throw Error('expected stored array');
            expect(materializedArrayItems(alias)).toEqual([2n, 8n, 4n, 10n, 6n, 12n]);
            expect(execute('Saved sum')).toBe(139n);
            expect(execute('View sum')).toBe(42n);
        } finally { host.dispose(); }
    });

    it('composes reshape addressing without completing its source', () => {
        const { host, execute, entries, sources } = runtime();
        try {
            execute("use sequences\nScaled' = Input * 2\nShaped' = Scaled reshape 3 2\nView' = Shaped transpose");
            const shaped = demandValue(host.variables.get('Shaped')!);
            if (!isRankArray(shaped)) throw Error('expected reshaped array');
            expect(materializedArrayItems(shaped)).toBeUndefined();
            expect(entries()).toBe(0);
            expect(execute('View sum')).toBe(42n);
            expect(entries()).toBe(compilation ? 1 : 0);
            if (compilation) expect(sources.at(-1)!).toContain('tensor:operator-guard:*');
        } finally { host.dispose(); }
    });

    it('preserves empty geometry but does not erase empty producer observations', () => {
        const { host, execute, entries, output } = runtime();
        host.variables.set('Input', ownedArray([], [2, 0]));
        try {
            execute("use sequences\nScaled' = Input * 2\nView' = Scaled transpose");
            const view = demandValue(host.variables.get('View')!);
            if (!isRankArray(view)) throw Error('expected empty view');
            expect(view.shape).toEqual([0, 2]);
            expect(execute('View sum')).toBe(0n);
            const before = entries();
            execute(`use io
fun X empty rank 0
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2) empty rank 0
Permuted' = Rows transpose`);
            expect(execute('Permuted sum')).toBe(0n);
            expect(execute('Permuted sum')).toBe(0n);
            expect(output).toEqual(['1', '2', '1', '2']);
            expect(entries()).toBe(before);
            expect(before).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('declines opaque source cells without probing them and preserves permuted early demand', () => {
        const { host, execute, entries } = runtime();
        const reads: number[] = [];
        host.variables.set('Input', { kind: 'array', shape: [2, 3],
            get items(): never { throw Error('must not collect host'); },
            itemAt(index) { reads.push(index); if (index === 1) throw Error('late source'); return 1n; },
        });
        try {
            execute("use sequences\nScaled' = Input * 2\nView' = Scaled transpose\nMask' = View greater 0");
            expect(reads).toEqual([]);
            expect(execute('Mask any')).toBe(true);
            expect(reads).toEqual([0]);
            expect(() => execute('Mask count')).toThrow('late source');
            expect(reads).toEqual([0, 0, 3, 1]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('rechecks work limits after a view kernel has been cached', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('Input', ownedArray(Array.from({ length: 16384 }, () => 1n), [128, 128]));
        try {
            execute("use sequences\nScaled' = Input * 2\nView' = Scaled transpose");
            expect(execute('View sum')).toBe(32768n);
            expect(() => withDemandBudget(100, () => execute('View sum'))).toThrow(DemandBudgetExhausted);
            expect(execute('View sum')).toBe(32768n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });
});

it('supplies fresh routes and checks to cached code and validates each coordinate in its own frame', () => {
    const code: TensorCodeCache = new Map();
    const sources: string[] = [], seen: [string, number, bigint][] = [];
    const input = ownedArray([11n, 22n, 33n, 44n], [2, 2]);
    const run = (positions: number[], shape: number[]) => {
        const source: TensorNode = { kind: 'input', value: input };
        const checked: TensorNode = { kind: 'check', source, validate(cell, index) {
            seen.push(['source', index, cell as bigint]); return cell;
        } };
        const view: TensorNode = { kind: 'view', source: checked, shape, offset: index => positions[index] };
        const result: TensorNode = { kind: 'check', source: view, validate(cell, index) {
            seen.push(['view', index, cell as bigint]); return cell;
        } };
        const domains = new Map<TensorNode, readonly CompiledAtomType[]>([source, checked, view, result].map(node => [node, ['integer']]));
        return compileNativeTensorReduction(result, 'sum', domains,
            { lookup: () => undefined, builtin: () => true, compiled: source => sources.push(source) }, code).run();
    };
    expect(run([2, 0, 2, 1], [2, 2])).toBe(99n);
    expect(seen).toEqual([
        ['source', 2, 33n], ['view', 0, 33n], ['source', 0, 11n], ['view', 1, 11n],
        ['source', 2, 33n], ['view', 2, 33n], ['source', 1, 22n], ['view', 3, 22n],
    ]);
    seen.length = 0;
    expect(run([1, 3], [2])).toBe(66n);
    expect(seen).toEqual([['source', 1, 22n], ['view', 0, 22n], ['source', 3, 44n], ['view', 1, 44n]]);
    expect(sources).toHaveLength(1);
});

it('declines a native view invalidated by the compilation callback before reading cells', () => {
    let entries = 0, reads = 0;
    let view: RankArray;
    const withinPlan = tensorPlanScope({ lookup: () => undefined, builtin: () => true, compiled() {
        Object.defineProperty(view, 'itemAt', { value: () => { reads++; return 99n; } });
    } }, () => true, () => entries++);
    const operators = new Operators(() => {}, () => undefined);
    const result = withinPlan(() => {
        const scaled = operators.evaluateBinary('*', ownedArray([1n, 2n, 3n]), 2n) as RankArray;
        view = sliceArray(scaled, tensorSelection(scaled, [ownedArray([2n, 0n])])) as RankArray;
        registerTensorResult(view);
        return sumValue(view);
    });
    expect(result).toBe(198n);
    expect(reads).toBe(2);
    expect(entries).toBe(0);
});

it('detects selection detachment during compilation and uses its consistent snapshot on fallback', () => {
    let entries = 0;
    const source = ownedArray([10n, 20n, 30n]);
    noteArrayBinding(source);
    const withinPlan = tensorPlanScope({ lookup: () => undefined, builtin: () => true,
        compiled() { expect(arrayForWrite(source)).toBeUndefined(); },
    }, () => true, () => entries++);
    const result = withinPlan(() => {
        const view = sliceArray(source, tensorSelection(source, [ownedArray([2n, 0n])])) as RankArray;
        noteArrayBinding(view);
        registerTensorResult(view);
        return sumValue(view);
    });
    expect(result).toBe(40n);
    expect(entries).toBe(0);
    writeArrayCell(source, 0, 99n);
    expect(readArrayItem(source, 0)).toBe(99n);
});
