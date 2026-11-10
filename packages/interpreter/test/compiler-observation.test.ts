import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse } from '../src/index.js';
import { currentDiagnostics, recordFallback } from '../src/diagnostics.js';
import { prepareBoundedTensor } from '../src/jit/tensor-bounds.js';
import { typedArray } from '../src/array-storage.js';
import { runExecution, type Execution } from '../src/execution.js';
import { withCompilerSource, observeCompiler, observedRun } from '../src/compiler-observation.js';
import { prepareNumberTensor } from '../src/jit/tensor-number.js';
import { prepareLayoutNumberTensor } from '../src/jit/tensor-number-layout.js';
import type { TensorNode } from '../src/jit/tensor-kernel.js';

function execute(source: string, diagnostics?: RuntimeDiagnostics) {
    const runtime = new Interpreter(undefined, { sourceId: 'observation.ra' });
    try { return diagnostics ? diagnostics.run(() => runtime.execute(source)) : runtime.execute(source); }
    finally { runtime.dispose(); }
}

describe('compiler admission and execution observations', () => {
    it('distinguishes prepared loop alternatives from the selected backend with proven types', () => {
        const source = 'Total = 0\nfor I in 1 to 3\n Total += I\nend\nTotal';
        const stats = new RuntimeDiagnostics(Infinity, true);
        expect(execute(source, stats)).toBe(execute(source));
        expect(stats.compilerObservations).toEqual(expect.arrayContaining([
            expect.objectContaining({ backend: 'exact-loop', phase: 'prepare', outcome: 'prepared' }),
            expect.objectContaining({ backend: 'number-loop', phase: 'execute', outcome: 'selected',
                source: expect.objectContaining({ sourceId: 'observation.ra', line: 2 }),
                provenTypes: { I: 'integer', Total: 'integer' } }),
        ]));
        expect(stats.compilerObservations.some(entry => entry.backend === 'exact-loop' && entry.phase === 'execute')).toBe(false);
    });

    it('links an over-budget loop to reference execution without changing its result', () => {
        const source = 'Total = 0\nfor I in 1 to 2\n' + ' Total += I\n'.repeat(129) + 'end\nTotal';
        const stats = new RuntimeDiagnostics(Infinity, true);
        expect(execute(source, stats)).toBe(387n);
        expect(stats.compilerObservations).toEqual(expect.arrayContaining([
            expect.objectContaining({ backend: 'loop-dispatch', phase: 'prepare', outcome: 'declined',
                reasons: expect.arrayContaining(['loop:statement-budget:AssignmentStatement']) }),
            expect.objectContaining({ backend: 'interpreted-loop', phase: 'execute', outcome: 'selected',
                source: expect.objectContaining({ sourceId: 'observation.ra', line: 2 }) }),
        ]));
    });

    it('locates runtime guards from a candidate prepared before diagnostics were enabled', () => {
        const site = parse('A = 1').statements[0];
        const run = observedRun(site, 'test-backend', () => recordFallback('test-backend:shape-guard'));
        const stats = new RuntimeDiagnostics(64, true);
        expect(stats.run(run)).toBeUndefined();
        expect(stats.compilerObservations[0]).toMatchObject({ phase: 'execute', outcome: 'declined',
            reasons: ['test-backend:shape-guard'], source: { line: 1, column: 1 } });
        expect(stats.compilerRejections[0]).toMatchObject({ reason: 'test-backend:shape-guard', line: 1 });
    });

    it('shows the exact scalar backend after a speculative Number fallback', () => {
        const stats = new RuntimeDiagnostics(Infinity, true);
        const source = 'fun X square\n return X * X\nend\n100000000 square';
        expect(execute(source, stats)).toBe(10000000000000000n);
        expect(execute(source)).toBe(10000000000000000n);
        expect(stats.compilerObservations).toEqual(expect.arrayContaining([
            expect.objectContaining({ backend: 'scalar-function-number', phase: 'execute', outcome: 'declined',
                reasons: ['scalar-function-number:integer-exactness-guard'],
                source: expect.objectContaining({ function: 'square', line: 1 }) }),
            expect.objectContaining({ backend: 'scalar-function-direct', phase: 'execute', outcome: 'selected',
                source: expect.objectContaining({ function: 'square', line: 1 }) }),
        ]));
    });

    it('scopes suspended execution per resume and restores the caller on throw and return', () => {
        const site = parse('A = 1').statements[0];
        let closed = 0;
        const run = observedRun(site, 'generator', function* () {
            try { yield 'pause'; recordFallback('generator:resumed'); }
            finally { closed++; }
        }, undefined, true);
        const stats = new RuntimeDiagnostics(64, true);
        const iterator = stats.run(run);
        expect(currentDiagnostics()).toBeUndefined();
        expect(iterator.next()).toEqual({ done: false, value: 'pause' });
        expect(currentDiagnostics()).toBeUndefined();
        expect(iterator.next().done).toBe(true);
        expect(closed).toBe(1);
        expect(stats.compilerRejections[0]).toMatchObject({ reason: 'generator:resumed', line: 1 });
        const aborted = stats.run(run);
        aborted.next();
        expect(() => aborted.throw(new Error('stop'))).toThrow('stop');
        expect(currentDiagnostics()).toBeUndefined();
        expect(closed).toBe(2);
        const returned = stats.run(run);
        returned.next(); returned.return();
        expect(closed).toBe(3);
    });

    it('carries the source into driver-scheduled children without leaking into unrelated work', () => {
        const site = parse('A = 1').statements[0];
        function* child(): Execution<bigint> { recordFallback('child:guard'); return 7n; }
        const run = observedRun(site, 'parent', function* (): Execution<bigint> {
            return (yield { task: child() }) as bigint;
        }, undefined, true);
        const stats = new RuntimeDiagnostics(64, true);
        const task = stats.run(run);
        expect(runExecution(task)).toBe(7n);
        expect(stats.compilerRejections).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'child:guard', line: 1, region: expect.objectContaining({ backend: 'parent' }) }),
        ]));
        expect(currentDiagnostics()).toBeUndefined();
        recordFallback('unrelated');
        expect(stats.fallbacks.unrelated).toBeUndefined();
    });

    it('preserves live generated-source getters on an observed kernel', () => {
        const values = typedArray(new Float64Array(4096).fill(2), [4096]);
        const kernel = prepareBoundedTensor({ kind: 'binary', op: '+',
            left: { kind: 'input', name: 'A' }, right: { kind: 'input', name: 'B' } },
        { lookup: () => values, builtin: () => true });
        expect(kernel).toBeDefined();
        expect(kernel!.source).toBe('');
        expect(kernel!.run()).toBeDefined();
        expect(kernel!.source.length).toBeGreaterThan(0);
    });

    it('reports a bounded tensor cost decision with the proven input and result types', () => {
        const values = typedArray(new Int32Array([2, 3]), [2]);
        const stats = new RuntimeDiagnostics(Infinity, true);
        const site = parse('Values + Values').statements[0];
        const kernel = stats.run(() => withCompilerSource(site, () => prepareBoundedTensor({ kind: 'binary', op: '+',
            left: { kind: 'input', name: 'Values' }, right: { kind: 'input', name: 'Values' } },
        { lookup: () => values, builtin: () => true })));
        expect(kernel).toBeDefined();
        expect(stats.run(() => kernel!.run())).toBeUndefined();
        expect(stats.compilerObservations).toEqual(expect.arrayContaining([
            expect.objectContaining({ backend: 'bounded-tensor', phase: 'execute', outcome: 'declined',
                reasons: ['bounded-tensor:small-integer-allocation-cost'],
                provenTypes: { Values: 'integer[rank=1]', result: 'integer[rank=1]' },
                source: expect.objectContaining({ line: 1 }) }),
        ]));
    });

    for (const [backend, prepare] of [
        ['number-tensor', prepareNumberTensor],
        ['layout-number-tensor', prepareLayoutNumberTensor],
    ] as const) {
        it(`${backend} explains rejected result domains at the source demand`, () => {
            const stats = new RuntimeDiagnostics(Infinity, true);
            const root: TensorNode = { kind: 'input', value: 1.5 };
            const site = parse('Values sum').statements[0];
            expect(stats.run(() => withCompilerSource(site, () =>
                prepare(root, new Map([[root, ['real']]]), 'sum', new Map(), () => true)))).toBeUndefined();
            expect(stats.compilerObservations).toEqual(expect.arrayContaining([
                expect.objectContaining({ backend, phase: 'prepare', outcome: 'declined',
                    reasons: [`${backend}:result-domain-guard`], provenTypes: { result: 'real' },
                    source: expect.objectContaining({ line: 1 }) }),
            ]));
        });

        it(`${backend} distinguishes zero division from integer overflow`, () => {
            for (const [op, value, reason] of [
                ['//', 0n, 'zero-divisor-guard'],
                ['*', 9007199254740991n, 'integer-exactness-guard'],
            ] as const) {
                const stats = new RuntimeDiagnostics(Infinity, true);
                const left: TensorNode = { kind: 'input', value: typedArray(new Int32Array([2, 3]), [2]) };
                const right: TensorNode = { kind: 'input', value };
                const root: TensorNode = { kind: 'binary', op, left, right };
                const domains = new Map<TensorNode, readonly 'integer'[]>([
                    [left, ['integer']], [right, ['integer']], [root, ['integer']],
                ]);
                const site = parse('Values sum').statements[0];
                const candidate = stats.run(() => withCompilerSource(site, () =>
                    prepare(root, domains, 'sum', new Map(), () => true)));
                expect(candidate).toBeDefined();
                expect(candidate!()).toBeUndefined();
                expect(stats.run(candidate!)).toBeUndefined();
                expect(stats.compilerObservations).toEqual(expect.arrayContaining([
                    expect.objectContaining({ backend, phase: 'prepare', outcome: 'prepared' }),
                    expect.objectContaining({ backend, phase: 'execute', outcome: 'declined',
                        reasons: [`${backend}:${reason}`], source: expect.objectContaining({ line: 1 }) }),
                ]));
            }
        });
    }

    it('does not inspect runtime values to produce a diagnostic', () => {
        const site = parse('A = 1').statements[0];
        const value = new Proxy({}, { has() { throw new Error('inspection'); }, get() { throw new Error('inspection'); } });
        const stats = new RuntimeDiagnostics(64, true);
        expect(stats.run(() => observeCompiler(site, 'native', 'execute', () => value))).toBe(value);
    });

    it('explains a named-array fusion refusal without calling the whole expression unsupported', () => {
        const stats = new RuntimeDiagnostics(Infinity, true);
        expect(execute('A = 1 to 10\nB = A * A\nB sum', stats)).toBe(385n);
        expect(stats.compilerObservations).toEqual(expect.arrayContaining([
            expect.objectContaining({ backend: 'fused-sum', outcome: 'declined',
                reasons: ['fused-sum:inline-arithmetic-required'], source: expect.objectContaining({ line: 3 }) }),
            expect.objectContaining({ backend: 'native-call', phase: 'execute', outcome: 'selected',
                source: expect.objectContaining({ line: 3 }) }),
        ]));
        expect(stats.compilerObservations.filter(entry => entry.outcome === 'declined' && !entry.reasons.length)).toEqual([]);
    });

    it('observes generated computed writes at their assignment site', () => {
        const stats = new RuntimeDiagnostics(Infinity, true);
        const source = 'use sequences\nuse numbers\nA = array shape 10000 fill 1\nK = 2 to 100 array\nAt\' = 2 * K\nA At += 2 * K + 3\nA sum';
        expect(execute(source, stats)).toBe(20395n);
        expect(stats.compilerObservations).toEqual(expect.arrayContaining([
            expect.objectContaining({ backend: 'computed-array-update', phase: 'execute', outcome: 'selected',
                source: expect.objectContaining({ sourceId: 'observation.ra', line: 6 }) }),
        ]));
    });
});
