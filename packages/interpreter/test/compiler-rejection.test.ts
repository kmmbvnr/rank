import { describe, expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { ownedArray } from '../src/array-storage.js';
import { registerSource } from '../src/source-location.js';
import { scalarFunctionResult } from '../src/scalar-function-proof.js';

function proof(expression: string) {
    const statement = parse(`fun X helper\nreturn ${expression}\nend`).statements[0];
    if (!isFunctionStatement(statement)) throw new Error('expected function');
    return statement;
}

function execute(source: string, diagnostics?: RuntimeDiagnostics, scalarFunctionCompilation = true) {
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation });
    try {
        const run = () => formatValue(runtime.execute(source)!);
        return diagnostics ? diagnostics.run(run) : run();
    } finally { runtime.dispose(); }
}

describe('attributable compiler rejections', () => {
    it('retains the failing name and source location when a proof was cached without diagnostics', () => {
        const statement = proof('X + K');
        scalarFunctionResult(statement);
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            scalarFunctionResult(statement);
            scalarFunctionResult(statement);
        });
        expect(diagnostics.fallbacks).toEqual({ 'scalar-function:unbound-name:NameExpression': 2 });
        expect(diagnostics.compilerRejections).toEqual([{
            reason: 'scalar-function:unbound-name:NameExpression', node: 'NameExpression',
            sourceId: '<input>', operation: 'K', name: 'K', function: 'helper', expression: 'K', line: 2, column: 12, endLine: 2, endColumn: 13,
        }]);
    });

    it('bounds syntax snapshots without limiting the fallback counters', () => {
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            for (let i = 0; i < 80; i++) scalarFunctionResult(proof(`X + Missing${i}`));
        });
        expect(diagnostics.compilerRejections).toHaveLength(64);
        expect(diagnostics.compilerRejectionsOmitted).toBe(16);
        expect(diagnostics.fallbacks['scalar-function:unbound-name:NameExpression']).toBe(80);
        const long = new RuntimeDiagnostics();
        long.run(() => scalarFunctionResult(proof(`array ${'1 '.repeat(200)}`)));
        expect(long.compilerRejections[0].expression).toHaveLength(160);
    });

    it.each([
        ['X reverse', 'scalar-function:unsupported-op:reverse'],
        ['X ** 2', 'scalar-function:unsupported-op:**'],
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
            runtime.execute('fun A same B\nreturn (A + B) equal A\nend\nLeft = array 1 2\nRight = array 3 4\nLeft same Right');
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute('Left same Right'));
            expect(formatValue(result!)).toBe('false false');
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

    it('reports the first unsupported loop child without parent or generic duplicates', () => {
        const source = 'use text\nText = "abc"\nfor I in 1 to 2\n if I greater 0\n Text = Text "" "" translate\n end\nend\nText';
        const diagnostics = new RuntimeDiagnostics();
        expect(execute(source, diagnostics)).toBe(execute(source));
        const loopReasons = Object.fromEntries(Object.entries(diagnostics.fallbacks).filter(([name]) => name.startsWith('loop:')));
        expect(loopReasons).toEqual({ 'loop:unsupported-op:translate': 1 });
    });

    it('names unsupported loop headers and leaves successful loops without rejection counts', () => {
        const rejected = new RuntimeDiagnostics();
        expect(execute('Total = 0\nfor I in (array 1 2)\nTotal += I\nend\nTotal', rejected)).toBe('3');
        expect(Object.fromEntries(Object.entries(rejected.fallbacks).filter(([name]) => name.startsWith('loop:'))))
            .toEqual({ 'loop:loop-header:ForStatement': 1 });
        const accepted = new RuntimeDiagnostics();
        expect(execute('Total = 0\nfor I in 1 to 2\nTotal += I\nend\nTotal', accepted)).toBe('3');
        expect(accepted.compiledLoops).toBe(1);
        expect(Object.keys(accepted.fallbacks).filter(name => name.startsWith('loop:'))).toEqual([]);
    });

    it('names a tensor operation whose generated type guard declined', () => {
        const source = `use sequences
fun A same B
  return (A equal B) count
end
A = array true false
B = array 1 0
A same B`;
        const diagnostics = new RuntimeDiagnostics();
        expect(() => execute(source, diagnostics, false)).toThrow(/cannot compare boolean and numeric/);
        expect(() => execute(source, undefined, false)).toThrow(/cannot compare boolean and numeric/);
        expect(diagnostics.fallbacks['tensor:operator-guard:equal']).toBeGreaterThan(0);
        expect(diagnostics.fallbacks).not.toHaveProperty('tensor:unsupported');
        expect(diagnostics.fallbacks).not.toHaveProperty('tensor:entry-guard');
        expect(diagnostics.compiledTensors).toBe(0);
    });

    it('records a rejected tensor power without changing the reference result', () => {
        const source = `fun A powers B
  return (A ** B) sum
end
A = array 2.0 3.0
B = array -1.0 -2.0
A powers B`;
        const diagnostics = new RuntimeDiagnostics();
        expect(execute(source, diagnostics)).toBe(execute(source));
        // Whole-program routing can avoid this candidate. Exercise its guard directly.
        const statement = parse(source).statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const values = { A: ownedArray([2, 3]), B: ownedArray([-1, -2]) };
        const kernel = compileTensorKernel(statement.statements[0], {
            lookup: name => values[name as keyof typeof values], builtin: () => true,
        });
        expect(kernel).toBeDefined();
        expect(diagnostics.run(() => kernel!.run())).toBeUndefined();
        expect(diagnostics.fallbacks['tensor:operator-guard:**']).toBeGreaterThan(0);
    });
    it('reports only the first unsupported tensor node, not its parents', () => {
        const statement = parse('fun A probe B\nMapped = (A to B) + (A reverse)\nreturn Mapped sum\nend').statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const diagnostics = new RuntimeDiagnostics();
        const kernel = diagnostics.run(() => compileTensorKernel(statement.statements[0], {
            lookup: () => undefined, builtin: () => true,
        }));
        expect(kernel).toBeUndefined();
        expect(diagnostics.fallbacks).toEqual({ 'tensor:unsupported-op:to': 1 });
    });

    it('reports one storage rejection per tensor entry attempt', () => {
        const statement = parse('fun A probe B\nreturn (A + B) sum\nend').statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const kernel = compileTensorKernel(statement.statements[0], {
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
        const statement = parse('fun A probe B\nreturn (A equal B) count\nend').statements[0];
        if (!isFunctionStatement(statement)) throw new Error('expected function');
        const values = ownedArray([true, false]), integers = ownedArray([1n, 0n]);
        const kernel = compileTensorKernel(statement.statements[0], {
            lookup: name => name === 'A' ? values : name === 'B' ? integers : undefined,
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

it('attributes the complete nested loop statement budget before executing any compiled writes', () => {
    const branch = 'if I greater 0\n' + ' Total = I\n'.repeat(8) + 'end\n';
    const source = 'Total = 0\nfor I in 1 to 2\n' + branch.repeat(20) + 'end\nTotal';
    const diagnostics = new RuntimeDiagnostics();
    expect(execute(source, diagnostics)).toBe('2');
    expect(diagnostics.compiledLoops).toBe(0);
    expect(diagnostics.fallbacks['loop:statement-budget:AssignmentStatement']).toBe(1);
});

it('retains all sites on request and distinguishes identical code in different files', () => {
    const diagnostics = new RuntimeDiagnostics(Infinity);
    diagnostics.run(() => {
        for (let i = 0; i < 80; i++) {
            const statement = proof('X + Missing');
            registerSource(statement, `/modules/${i}.ra`);
            scalarFunctionResult(statement);
            scalarFunctionResult(statement);
        }
    });
    expect(diagnostics.compilerRejections).toHaveLength(80);
    expect(diagnostics.compilerRejectionsOmitted).toBe(0);
    expect(diagnostics.compilerRejections[79].sourceId).toBe('/modules/79.ra');
    expect(diagnostics.fallbacks['scalar-function:unbound-name:NameExpression']).toBe(160);
});

it('does not count retained duplicates as omitted after reaching the site limit', () => {
    const statement = proof('X + Missing');
    const diagnostics = new RuntimeDiagnostics(1);
    diagnostics.run(() => {
        scalarFunctionResult(statement);
        scalarFunctionResult(statement);
        scalarFunctionResult(proof('X + Other'));
    });
    expect(diagnostics.compilerRejections).toHaveLength(1);
    expect(diagnostics.compilerRejectionsOmitted).toBe(1);
});
