import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { compileClauseExpression, type ClauseExpressionContext } from '../src/clause-expression.js';
import { completed, runExecution } from '../src/execution.js';
import { withDemandBudget } from '../src/interrupt.js';
import type { RankArray } from '../src/value.js';

const comparisons = {
    equal: (a: bigint, b: bigint) => a === b,
    'not equal': (a: bigint, b: bigint) => a !== b,
    less: (a: bigint, b: bigint) => a < b,
    greater: (a: bigint, b: bigint) => a > b,
    'at most': (a: bigint, b: bigint) => a <= b,
    'at least': (a: bigint, b: bigint) => a >= b,
};
it.each(Object.entries(comparisons))('searches ready integer %s comparisons without a mask', (operation, test) => {
    const values = [-2147483648, -1, 0, 7, 7, 2147483647];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        runtime.variables.set('Values', typedArray(Int32Array.from(values)));
        try {
            for (const target of [-(1n << 100n), -2147483649n, -2147483648n, -1n, 0n, 7n, 2147483647n, 2147483648n, 1n << 100n]) {
                runtime.variables.set('Target', target);
                const index = values.findIndex(value => test(BigInt(value), target));
                for (const subject of [true, false]) for (const indexOnly of [true, false]) {
                    const expression = `Values first ${indexOnly ? 'index ' : ''}where ${subject ? '' : 'Values '}${operation} Target`;
                    if (index < 0) expect(() => diagnostics.run(() => runtime.execute(expression))).toThrow('found no matching value');
                    else expect(diagnostics.run(() => runtime.execute(expression))).toBe(BigInt(indexOnly ? index : values[index]));
                }
            }
            expect(diagnostics.nativeFirstSearches).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    }
});
it('refreshes warmed sources and leaves real, wide and lazy operands on the ordinary path', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    try {
        runtime.variables.set('Values', typedArray(Int32Array.of(1, 2, 3)));
        expect(runtime.execute('Values first index where greater 1')).toBe(1n);
        const sources = [typedArray(Float64Array.of(1.5, 2.5)), ownedArray([1n << 100n, 2n << 100n])];
        for (const source of sources) {
            runtime.variables.set('Values', source);
            const diagnostics = new RuntimeDiagnostics();
            expect(diagnostics.run(() => runtime.execute('Values first index where greater 1'))).toBe(0n);
            expect(diagnostics.nativeFirstSearches).toBe(0);
        }
        runtime.execute("Values' = (array 1 0) // (array 1 0)");
        expect(runtime.execute('Values first index where greater 0')).toBe(0n);
        expect(() => runtime.execute('Values first index where less 0')).toThrow('zero');
    } finally { runtime.dispose(); }
});
it('keeps budgets, foreign readers and shared storage off the native search', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    try {
        const shared = new Int32Array(new SharedArrayBuffer(12)); shared.set([1, 2, 3]);
        const foreign: RankArray = { kind: 'array', shape: [3], items: [], itemAt: i => BigInt(i + 1) };
        for (const source of [typedArray(shared), foreign]) {
            runtime.variables.set('Values', source);
            const diagnostics = new RuntimeDiagnostics();
            expect(diagnostics.run(() => runtime.execute('Values first index where greater 1'))).toBe(1n);
            expect(diagnostics.nativeFirstSearches).toBe(0);
        }
        runtime.variables.set('Values', typedArray(Int32Array.of(1, 2, 3)));
        const diagnostics = new RuntimeDiagnostics();
        expect(diagnostics.run(() => withDemandBudget(1000, () => runtime.execute('Values first index where greater 1')))).toBe(1n);
        expect(diagnostics.nativeFirstSearches).toBe(0);
    } finally { runtime.dispose(); }
});
it('does not bypass a custom clause evaluator without its integer comparison proof', () => {
    const statement = parse('Result = Values first index where Values greater 0').statements[0];
    if (statement.$type !== 'AssignmentStatement') throw Error('assignment');
    const source = typedArray(Int32Array.of(1, 2));
    let evaluations = 0;
    const context: ClauseExpressionContext = {
        localFrame: undefined, findVariable: () => source, binary: () => { throw Error('unused'); },
        evaluate: () => completed(++evaluations === 1 ? source : ownedArray([false, true])),
    };
    const clause = compileClauseExpression(statement.value, () => context)!;
    expect(runExecution(clause())).toBe(1n);
    expect(evaluations).toBe(2);
});
it('does not add getter reads while rejecting modified source metadata', () => {
    const statement = parse('Result = Values first index where Values greater 0').statements[0];
    if (statement.$type !== 'AssignmentStatement') throw Error('assignment');
    const reads: number[] = [];
    for (const enabled of [false, true]) {
        const source = typedArray(Int32Array.of(1, 2));
        let count = 0, evaluations = 0;
        Object.defineProperty(source, 'shape', { get() { count++; return [2]; }, configurable: true });
        const context: ClauseExpressionContext = {
            storedIntegerComparisons: enabled, localFrame: undefined, findVariable: () => source,
            binary: () => { throw Error('unused'); },
            evaluate: () => completed(++evaluations === 1 ? source : ownedArray([true, true])),
        };
        const diagnostics = new RuntimeDiagnostics();
        expect(diagnostics.run(() => runExecution(compileClauseExpression(statement.value, () => context)!()))).toBe(0n);
        expect(diagnostics.nativeFirstSearches).toBe(0);
        reads.push(count);
    }
    expect(reads[1]).toBe(reads[0]);
});
