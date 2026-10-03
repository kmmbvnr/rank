import { describe, expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { ownedArray } from '../src/array-storage.js';
import { scalarFunctionResult } from '../src/scalar-function-proof.js';

function proof(expression: string) {
    const statement = parse(`fun helper X\nreturn ${expression}\nend`).statements[0];
    if (!isFunctionStatement(statement)) throw new Error('expected function');
    return statement;
}

function execute(source: string, diagnostics?: RuntimeDiagnostics) {
    const runtime = new Interpreter();
    try {
        const run = () => formatValue(runtime.execute(source)!);
        return diagnostics ? diagnostics.run(run) : run();
    } finally { runtime.dispose(); }
}

describe('attributable compiler rejections', () => {
    it.each([
        ['X reverse', 'scalar-function:unsupported-op:reverse'],
        ['X / 2', 'scalar-function:unsupported-op:/'],
        ['X + (array 0.5)', 'scalar-function:unsupported-type:array'],
        ['array 1 2', 'scalar-function:unsupported-type:array'],
    ])('retains the reason for cached proof rejection: %s', (expression, reason) => {
        const statement = proof(expression);
        // Cache the failed proof before instrumentation is enabled.
        expect(scalarFunctionResult(statement)).toBeUndefined();
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            expect(scalarFunctionResult(statement)).toBeUndefined();
            expect(scalarFunctionResult(statement)).toBeUndefined();
        });
        expect(diagnostics.fallbacks).toEqual({ [reason]: 2 });
    });

    it('does not record a rejection for successful cached scalar proof', () => {
        const statement = proof('X * 2'), diagnostics = new RuntimeDiagnostics();
        scalarFunctionResult(statement);
        diagnostics.run(() => expect(scalarFunctionResult(statement)?.type).toBe('integer'));
        expect(diagnostics.fallbacks).toEqual({});
    });

    it('attributes per-operation fallback in a cached scalar expression', () => {
        const runtime = new Interpreter(undefined, { scalarFunctionCompilation: false });
        try {
            runtime.execute('fun same A B\nreturn (A + B) equal A\nend\n"a" "b" same');
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute('"a" "b" same'));
            expect(formatValue(result!)).toBe('false');
            expect(diagnostics.fallbacks['scalar-expression:operator-guard:+']).toBeGreaterThan(0);
            expect(diagnostics.fallbacks['scalar-expression:operator-guard:equal']).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('names the loop operation without changing execution', () => {
        const source = 'use text\nText = "abλ"\nfor I in 1 to 2\nText = Text "" "" translate\nend\nText';
        const diagnostics = new RuntimeDiagnostics();
        expect(execute(source, diagnostics)).toBe(execute(source));
        expect(diagnostics.fallbacks['loop:unsupported-op:translate']).toBeGreaterThan(0);
        expect(diagnostics.compiledLoops).toBe(0);
    });

    it('names a tensor operation whose generated type guard declined', () => {
        const source = `use sequences
fun same A B
  Mapped = A equal B
  return Mapped count
end
A = array true false
B = array true false
A B same`;
        const diagnostics = new RuntimeDiagnostics();
        expect(execute(source, diagnostics)).toBe(execute(source));
        expect(diagnostics.fallbacks['tensor:operator-guard:equal']).toBeGreaterThan(0);
        expect(diagnostics.fallbacks).not.toHaveProperty('tensor:unsupported');
        expect(diagnostics.fallbacks).not.toHaveProperty('tensor:entry-guard');
        expect(diagnostics.compiledTensors).toBe(0);
    });

    it('records a rejected tensor power without changing the reference result', () => {
        const source = `fun powers A B
  Mapped = A ** B
  return Mapped sum
end
A = array 2.0 3.0
B = array -1 -2
A B powers`;
        const diagnostics = new RuntimeDiagnostics();
        expect(execute(source, diagnostics)).toBe(execute(source));
        expect(diagnostics.fallbacks['tensor:operator-guard:**']).toBeGreaterThan(0);
        expect(diagnostics.compiledTensors).toBe(0);
    });
    it('reports only the first unsupported tensor node, not its parents', () => {
        const statement = parse('fun probe A B\nMapped = (A to B) + (A reverse)\nreturn Mapped sum\nend').statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const diagnostics = new RuntimeDiagnostics();
        const kernel = diagnostics.run(() => compileTensorKernel(statement.statements, {
            lookup: () => undefined, builtin: () => true,
        }));
        expect(kernel).toBeUndefined();
        expect(diagnostics.fallbacks).toEqual({ 'tensor:unsupported-op:to': 1 });
    });

    it('reports one storage rejection per tensor entry attempt', () => {
        const statement = parse('fun probe A B\nMapped = A + B\nreturn Mapped sum\nend').statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const kernel = compileTensorKernel(statement.statements, {
            lookup: name => name === 'A' || name === 'B' ? { kind: 'array', shape: [2], items: [1n, 2n] } : undefined,
            builtin: () => true,
        });
        expect(kernel).toBeDefined();
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            expect(kernel!.run()).toBeUndefined();
            expect(kernel!.run()).toBeUndefined();
        });
        expect(diagnostics.fallbacks).toEqual({ 'tensor:untracked-storage': 2 });
    });

    it('reports the generated guard when a cached tensor kernel declines', () => {
        const statement = parse('fun probe A B\nMapped = A equal B\nreturn Mapped count\nend').statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const values = ownedArray([true, false]);
        const kernel = compileTensorKernel(statement.statements, {
            lookup: name => name === 'A' || name === 'B' ? values : undefined,
            builtin: () => true,
        });
        expect(kernel).toBeDefined();
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            expect(kernel!.run()).toBeUndefined();
            expect(kernel!.run()).toBeUndefined();
        });
        expect(diagnostics.fallbacks).toEqual({ 'tensor:operator-guard:equal': 2 });
    });

});
