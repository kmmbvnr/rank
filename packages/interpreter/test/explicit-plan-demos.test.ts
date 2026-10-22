import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, demand, formatValue, parse, isRankPlan, isRankTuple, isNativeFunction, type RankArray, type NativeFunction } from '../src/index.js';
import { sequence, windowValue } from '../src/sequence.js';
import { isStoredValue } from '../src/stored-value.js';
import { runExecution } from '../src/execution.js';
import { denseScalarItems, materializedArrayItems, derivedArray } from '../src/array-storage.js';

const euler4 = readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8');
const covariance = readFileSync(new URL('../../../demos/deepml/010_cov.ra', import.meta.url), 'utf8');
const windows = readFileSync(new URL('../../../demos/classic/windows.ra', import.meta.url), 'utf8');

describe.each([false, true])('explicit-plan demo migration (compilation=%s)', compilation => {
    it.each([
        ['022_sigmoid', 'sigmoid', [3], '0.2689 0.5 0.7311'],
        ['035_diag', 'make_diagonal', [3, 3], '-1 0 0 0 0 0 0 0 1'],
    ] as const)('keeps a planned input deferred through %s', (name, helper, shape, expected) => {
        const source = readFileSync(new URL(`../../../demos/deepml/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        runtime.variables.set('Input', derivedArray([3], [], index => { reads++; return BigInt(index - 1); }));
        try {
            runtime.execute(source);
            runtime.execute(`Result' = Input ${helper}`);
            expect(reads).toBe(0);
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            const saved = runtime.execute('Saved = Result')!;
            expect(saved).toMatchObject({ shape });
            expect(formatValue(saved)).toBe(expected);
            expect(isStoredValue(saved)).toBe(true);
            const before = reads;
            expect(formatValue(runtime.execute('Result')!)).toBe(expected);
            expect(reads).toBeGreaterThan(before);
            const after = reads;
            expect(formatValue(runtime.execute('Saved')!)).toBe(expected);
            expect(reads).toBe(after);
        } finally { runtime.dispose(); }
    });

    it('retains one shuffle order while returning deferred sample selections', () => {
        const source = readFileSync(new URL('../../../demos/deepml/029_shuf.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source);
            runtime.execute('use sequences');
            runtime.execute([
                'State = 42 seed', 'X = array shape 4 1', '10 20 30 40', 'end',
                'Y = array 1 2 3 4', "Result' = X Y shuffle_data",
                'State = 999 seed', 'First = Result', 'Second = Result',
            ].join('\n'));
            expect(formatValue(runtime.variables.get('First')!)).toBe(formatValue(runtime.variables.get('Second')!));
            runtime.execute('unpack ShuffledX ShuffledY = First');
            expect(runtime.execute('ShuffledX len equal 4')).toBe(true);
            expect(runtime.execute('((ShuffledX reshape 4) equal (ShuffledY * 10)) all')).toBe(true);
            expect(runtime.execute('(ShuffledY sort equal (array 1 2 3 4)) all')).toBe(true);
            const saved = runtime.variables.get('First')!;
            if (!isRankTuple(saved)) throw new Error('expected retained sample pair');
            expect(saved.items).toHaveLength(2);
            for (const item of saved.items) {
                expect(denseScalarItems(item as RankArray)).toBeDefined();
            }
        } finally { runtime.dispose(); }
    });

    it('runs the actual matrix-product dot plans through native reductions when compilation is enabled', () => {
        const source = readFileSync(new URL('../../../demos/deepml/009_matmul.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(source);
            const result = diagnostics.run(() => runtime.execute([
                'A = array shape 2 3', '1 2 3', '4 5 6', 'end',
                'B = array shape 3 2', '7 8', '9 10', '11 12', 'end',
                'Result = A B matrixmul',
            ].join('\n')))!;
            expect(result).toMatchObject({ kind: 'array', shape: [2, 2] });
            expect(formatValue(result)).toBe('58 64 139 154');
            expect(isStoredValue(result)).toBe(true);
            expect(diagnostics.compiledTensors).toBe(compilation ? 4 : 0);
        } finally { runtime.dispose(); }
    });

    it('passes a planned tensor through the actual scalar-multiply helper without reading it on entry', () => {
        const source = readFileSync(new URL('../../../demos/deepml/005_scalmul.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        runtime.variables.set('Input', derivedArray([2, 2], [], index => { reads++; return BigInt(index + 1); }));
        try {
            runtime.execute(source);
            runtime.execute("Result' = Input 3 scalar_multiply");
            expect(reads).toBe(0);
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            const saved = runtime.execute('Saved = Result')!;
            expect(formatValue(saved)).toBe('3 6 9 12');
            expect(isStoredValue(saved)).toBe(true);
            const afterSaved = reads;
            expect(afterSaved).toBeGreaterThan(0);
            expect(runtime.execute('Result sum')).toBe(30n);
            expect(reads).toBeGreaterThan(afterSaved);
            const afterDemand = reads;
            expect(runtime.execute('Saved sum')).toBe(30n);
            expect(reads).toBe(afterDemand);
        } finally { runtime.dispose(); }
    });

    it('streams values through the actual fold helper without completing its input on entry', () => {
        const source = readFileSync(new URL('../../../demos/classic/fold.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        const observed: number[] = [];
        const input = sequence({ name: 'fold input', size: { kind: 'exact', value: 4n },
            *iterate() { for (let value = 1n; value <= 4n; value++) { reads++; yield value; } },
        });
        const combine: NativeFunction = { kind: 'function', name: 'observed addition', arities: [2], monadicRank: 'all',
            call([left, right]) { observed.push(reads); return (left as bigint) + (right as bigint); },
        };
        try {
            runtime.execute(source);
            const fold = runtime.variables.get('fold')!;
            if (!isNativeFunction(fold)) throw new Error('expected fold function');
            expect(fold.call([input, combine, 0n])).toBe(10n);
            expect(observed).toEqual([1, 2, 3, 4]);
            expect(reads).toBe(4);
        } finally { runtime.dispose(); }
    });

    it.each(['queens', 'queens_permutations', 'queens_recursive'])('keeps %s board rendering deferred over retained solutions', name => {
        const source = readFileSync(new URL(`../../../demos/classic/${name}.ra`, import.meta.url), 'utf8');
        const rendering = source.slice(source.indexOf("Mask' ="), source.indexOf('for Board i in Boards'));
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nuse text\nStates = array shape 1 4\n1 3 0 2\nend\nSols = States\nPlacements = States\nCols = array 0 1 2 3\nRow = Cols');
            diagnostics.run(() => runtime.execute(rendering));
            expect(diagnostics.cellsComputed).toBe(0);
            const boards = runtime.variables.get('Boards')!;
            expect(isRankPlan(boards)).toBe(true);
            const view = diagnostics.run(() => runExecution(demand(boards))) as RankArray;
            expect(view.shape).toEqual([1, 4, 4]);
            expect(isStoredValue(view)).toBe(false);
            expect(diagnostics.cellsComputed).toBe(0);
            expect(formatValue(view)).toBe('. Q . . . . . Q Q . . . . . Q .');
            expect(formatValue(runExecution(demand(boards)))).toBe(formatValue(view));
            expect(isStoredValue(runtime.variables.get('States')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

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
            runtime.executeProgram(parse(mutation), []);
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
