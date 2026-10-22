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
    it('retains Monopoly state while composing deferred matrices through native kernels', () => {
        const source = readFileSync(new URL('../../../demos/euler/084_monopolyodds.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(101524n);
            expect(isRankPlan(runtime.variables.get('Mat')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Land')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Seen')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Sq')!)).toBe(true);
            expect(runtime.execute('Land 36 5')).toBe(0.1875);
            if (compilation) expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            else expect(diagnostics.compiledTensors).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('stops the actual pandigital-prime pipeline before completing all permutations', () => {
        const source = readFileSync(new URL('../../../demos/euler/041_pandigitalprime.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let conversions = 0;
        const integer: NativeFunction = { kind: 'function', name: 'integer', arities: [1], monadicRank: 'all',
            call([value]) { conversions++; return BigInt(value as string); },
        };
        try {
            runtime.execute('use algo\nuse sequences');
            runtime.variables.set('integer', integer);
            runtime.declareFunctionSource(source);
            expect(runtime.execute('"7654321" largest_pandigital_prime')).toBe(7652413n);
            const first = conversions;
            expect(first).toBeGreaterThan(0);
            expect(first).toBeLessThan(5040);
            expect(runtime.execute('"7654321" largest_pandigital_prime')).toBe(7652413n);
            expect(conversions - first).toBe(first);
        } finally { runtime.dispose(); }
    });

    it('streams deals through the actual poker helper while retaining each hand for scoring', () => {
        const source = readFileSync(new URL('../../../demos/euler/054_poker.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        const observed: number[] = [];
        const deals = [
            '5H 5C 6S 7S KD 2C 3S 8S 8D TD', '5D 8C 9S JS AC 2C 5C 7D 8S QH',
            '2D 9C AS AH AC 3D 6D 7D TD QD', '4D 6S 9H QH QC 3D 6D 7H QD QS',
            '2H 2D 4C 4D 4S 3C 3D 3S 9S 9D',
        ];
        runtime.variables.set('Deals', sequence({ name: 'poker deals', size: { kind: 'exact', value: 5n },
            *iterate() { for (const deal of deals) { reads++; yield deal; } },
        }));
        try {
            runtime.execute('use sequences\nuse text\nRanks = "23456789TJQKA"');
            runtime.declareFunctionSource(source);
            const score = runtime.variables.get('hand_score')!;
            if (!isNativeFunction(score)) throw new Error('expected hand score');
            runtime.variables.set('hand_score', { kind: 'function', name: 'hand_score', arities: [1], monadicRank: 'all',
                call(args) { observed.push(reads); return score.call(args); },
            });
            expect(runtime.execute('Deals poker_wins')).toBe(3n);
            expect(observed).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
            expect(reads).toBe(5);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['047_primefactors', '2 distinct_factor_run', 14n],
        ['051_primedigits', '121313 has_eight_prime_family', true],
        ['052_permutedmultiples', '142857 permuted', true],
        ['056_digitsum', '(2 ** 1000) digit_sum', 1366n],
        ['059_xor', '((array 65) (array 42) decrypt equal (array 107)) all', true],
        ['060_primepairs', 'Data = 20 build\nGraph = Data .graph\nGraph 3 7 adjacent', true],
    ] as const)('runs the actual Euler %s helper on a small input', (name, expression, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use algo\nuse numbers\nuse sequences\nuse bits\nuse graph');
            runtime.declareFunctionSource(source);
            expect(runtime.execute(expression)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['021_amicable', '300 amicable_sum', 504n],
        ['021_amicable', '220 proper_divisor_sum', 284n],
        ['021_amicable', '284 proper_divisor_sum', 220n],
        ['021_amicable', '16 proper_divisor_sum', 15n],
        ['030_digitpowers', '1634 4 digit_power_sum', 1634n],
        ['030_digitpowers', '1 digit_power_numbers', 44n],
        ['035_circularprimes', '100 circular_prime_count', 13n],
    ] as const)('runs the actual Euler %s helper on a bounded input: %s', (name, expression, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use numbers\nuse sequences');
            runtime.declareFunctionSource(source);
            expect(runtime.execute(expression)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['022_sigmoid', 'sigmoid', [3], '0.2689 0.5 0.7311'],
        ['035_diag', 'make_diagonal', [3, 3], '-1 0 0 0 0 0 0 0 1'],
        ['042_relu', 'relu', [3], '0 0 1'],
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

    it.each([
        ['041_conv2d', [3, 3], 'Input Kernel 0 1 simple_conv2d', [2, 2], '12 16 24 28'],
        ['045_kernel', [2, 2], 'Input Identity kernel_function', [2, 2], '1 2 3 4'],
        ['055_translate', [2, 2], 'Input 10 (-1) translate_object', [2, 2], '11 1 13 3'],
    ] as const)('keeps planned matrix data deferred through %s', (name, inputShape, expression, outputShape, expected) => {
        const source = readFileSync(new URL(`../../../demos/deepml/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        runtime.variables.set('Input', derivedArray([...inputShape], [], index => { reads++; return BigInt(index + 1); }));
        try {
            runtime.execute(source);
            runtime.execute('Kernel = array shape 2 2 fill 1\nIdentity = array shape 2 2\n1 0\n0 1\nend');
            runtime.execute(`Result' = ${expression}`);
            expect(reads).toBe(0);
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            const saved = runtime.execute('Saved = Result')!;
            expect(saved).toMatchObject({ shape: outputShape });
            expect(formatValue(saved)).toBe(expected);
            const afterSaved = reads;
            expect(afterSaved).toBeGreaterThan(0);
            expect(formatValue(runtime.execute('Result')!)).toBe(expected);
            expect(reads).toBeGreaterThan(afterSaved);
            const after = reads;
            expect(formatValue(runtime.execute('Saved')!)).toBe(expected);
            expect(reads).toBe(after);
        } finally { runtime.dispose(); }
    });

    it('executes Adam callbacks once per step and retains its completed iteration state', () => {
        const source = readFileSync(new URL('../../../demos/deepml/049_adam.ra', import.meta.url), 'utf8');
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(source);
            runtime.execute([
                'use io', 'fun X gradient', ' "gradient" print', ' return X * 2', 'end',
                'Input = array 1.0 1.0', "Result' = Input adam_optimizer gradient",
            ].join('\n'));
            expect(output).toEqual(Array(10).fill('gradient'));
            expect(formatValue(runtime.execute('Result round 8')!)).toBe('0.99000325 0.99000325');
            expect(formatValue(runtime.execute('Result round 8')!)).toBe('0.99000325 0.99000325');
            expect(output).toHaveLength(10);
            expect(formatValue(runtime.execute('Input')!)).toBe('1 1');
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
