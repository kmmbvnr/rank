import { describe, expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';
import { compileNativeTensorReduction, type TensorNode } from '../src/tensor-kernel.js';
import { ownedArray } from '../src/array-storage.js';

function run(source: string, compilation = true) {
    let functions = 0;
    const runtime = new Interpreter(undefined, { compilation, onScalarFunctionExecuted: () => functions++ });
    try { return { value: formatValue(runtime.execute(source)!), functions }; }
    finally { runtime.dispose(); }
}

function outerStages(depth: number) {
    return Array.from({ length: depth }, (_, i) => ` M${i}' = S${i} S${i} outer +\n S${i + 1}' = M${i} sum rank 1`).join('\n');
}

describe('shared tensor DAG lowering', () => {
    it('bounds inline code when shared producers are repeatedly reindexed', () => {
        const source = `fun Input total\n S0' = Input * 2\n${outerStages(8)}\n R = S8 sum\n return R\nend`;
        const statement = parse(source).statements[0];
        if (!isFunctionStatement(statement)) throw Error('expected function');
        const kernel = compileScalarFunction(statement, [{ kind: 'array', element: 'integer', rank: 1 }], true)!;
        expect(kernel).toBeDefined();
        expect(kernel.source.length).toBeLessThan(25000);
        expect(run(`${source}\n(array 1 2) total`)).toEqual({ value: String(6n * 4n ** 8n), functions: 1 });
        const small = `fun Input total\n S0' = Input * 2\n${outerStages(3)}\n R = S3 sum\n return R\nend\n(array 1 2) total`;
        expect(run(small).value).toBe(run(small, false).value);
    });

    it('keeps shape checks and separate demands with shared broadcast stages', () => {
        for (const right of ['array 10', 'array 10 20 30', 'array 10 20']) {
            const source = `fun A total B
 X' = A * 2
 Y' = X + B
 Z' = Y + X
 First = Z sum
 Second = Z sum
 return First + Second
end
(array 1 2 3) total (${right})`;
            const observe = (compiled: boolean) => {
                try { return run(source, compiled).value; }
                catch (error) { return String(error); }
            };
            expect(observe(true)).toBe(observe(false));
        }
    });

    it('emits native pointwise DAGs once without intermediate buffers', () => {
        const domains = new Map<TensorNode, readonly ['integer']>();
        const typed = (node: TensorNode): TensorNode => { domains.set(node, ['integer']); return node; };
        let root = typed({ kind: 'input', value: ownedArray([1n, 2n, 3n]) });
        for (let i = 0; i < 30; i++) root = typed({ kind: 'binary', op: '+', left: root, right: root });
        const kernel = compileNativeTensorReduction(root, 'sum', domains, { lookup: () => undefined, builtin: () => true }, new Map());
        expect(kernel.run()).toBe(6n * 2n ** 30n);
        expect(kernel.source.length).toBeLessThan(15000);
        expect(kernel.source).not.toContain('const cache');
    });

    it('buffers reindexed native stages once per demand without expanding their DAG', () => {
        const domains = new Map<TensorNode, readonly ['integer']>();
        const typed = (node: TensorNode): TensorNode => { domains.set(node, ['integer']); return node; };
        let root = typed({ kind: 'input', value: ownedArray([2n, 4n]) });
        for (let i = 0; i < 8; i++) {
            const outer = typed({ kind: 'outer', op: '+', left: root, right: root });
            root = typed({ kind: 'reduction', operation: 'sum', source: outer, rows: true });
        }
        const kernel = compileNativeTensorReduction(root, 'sum', domains, { lookup: () => undefined, builtin: () => true }, new Map());
        expect(kernel.run()).toBe(6n * 4n ** 8n);
        expect(kernel.run()).toBe(6n * 4n ** 8n);
        expect(kernel.source.length).toBeLessThan(25000);
        expect(kernel.source).toContain('const cache');
    });

    it.each(['+', '-', '*'])('routes large integer reduce %s through the native tensor kernel', operator => {
        let kernels = 0;
        const runtime = new Interpreter(undefined, { onTensorKernelExecuted: () => kernels++ });
        try {
            const value = runtime.execute(`A = array shape 2048 fill 0\n(A + 1) reduce ${operator}`);
            expect(value).toBe({ '+': 2048n, '-': -2046n, '*': 1n }[operator]);
            expect(kernels).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it.each(['sum', 'min', 'max', 'count'] as const)('uses reduction IR for native %s rows', operation => {
        const domains = new Map<TensorNode, readonly ('integer' | 'boolean')[]>();
        const input: TensorNode = { kind: 'input', value: ownedArray(operation === 'count' ? [true, false, true, true] : [1n, 2n, 3n, 4n], [2, 2]) };
        domains.set(input, [operation === 'count' ? 'boolean' : 'integer']);
        const rows: TensorNode = { kind: 'reduction', operation, source: input, rows: true };
        domains.set(rows, ['integer']);
        const root: TensorNode = { kind: 'binary', op: '+', left: rows, right: rows };
        domains.set(root, ['integer']);
        const kernel = compileNativeTensorReduction(root, 'sum', domains, { lookup: () => undefined, builtin: () => true }, new Map());
        expect(kernel.run()).toBe({ sum: 20n, min: 8n, max: 12n, count: 6n }[operation]);
        expect(kernel.run()).toBe({ sum: 20n, min: 8n, max: 12n, count: 6n }[operation]);
    });

    it.each(['+', '-', '*'])('preserves generic fold dispatch for mixed numeric inputs with %s', operator => {
        const source = `fun A total B
 R = ((A * 2) + (B - 1)) reduce ${operator}
 return R
end
(array 1 2 3) total (array 2.0 3.0 4.0)`;
        expect(run(source).value).toBe(run(source, false).value);
    });
});
