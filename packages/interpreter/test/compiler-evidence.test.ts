import { afterEach, describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { observeCompilerSource } from '../src/compiler-observation.js';

const site = { node: 'NumberLiteral', operation: 'test' };
afterEach(() => vi.restoreAllMocks());
describe('independent compiler evidence', () => {
    it('accounts nested preparation once and restores timing after an exception', () => {
        let time = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => time);
        const diagnostics = new RuntimeDiagnostics(0, false, true);
        diagnostics.run(() => {
            expect(() => observeCompilerSource(site, 'outer', 'prepare', () => {
                time += 2;
                observeCompilerSource(site, 'inner', 'prepare', () => { time += 3; return true; });
                time += 5;
                throw new Error('failure');
            })).toThrow('failure');
            observeCompilerSource(site, 'later', 'prepare', () => { time += 7; return true; });
        });
        expect(diagnostics.compilerPreparation).toEqual({
            outer: { calls: 1, milliseconds: 10, selfMilliseconds: 7, threw: 1 },
            inner: { calls: 1, milliseconds: 3, selfMilliseconds: 3, threw: 0 },
            later: { calls: 1, milliseconds: 7, selfMilliseconds: 7, threw: 0 },
        });
        expect(diagnostics.compilerObservations).toEqual([]);
    });
    it('retains execution totals when source details are truncated and separates delegation', () => {
        const diagnostics = new RuntimeDiagnostics(0, true);
        diagnostics.run(() => {
            for (let index = 0; index < 3; index++) observeCompilerSource(site, 'statement-dispatch', 'execute', () =>
                observeCompilerSource(site, 'native-call', 'execute', () => 1));
            observeCompilerSource(site, 'scalar-expression', 'execute', () => undefined);
        });
        expect(diagnostics.compilerObservations).toEqual([]);
        expect(diagnostics.compilerObservationsOmitted).toBe(7);
        expect(diagnostics.compilerExecution['native-call'].own.native).toBe(3);
        expect(diagnostics.compilerExecution['statement-dispatch'].completed).toBe(3);
        expect(diagnostics.compilerExecution['statement-dispatch'].own.interpreted).toBe(0);
        expect(diagnostics.compilerExecution['scalar-expression'].own.compiled).toBe(0);
        expect(diagnostics.compilerExecution['scalar-expression'].declined).toBe(1);
    });
    it('does not count an unconsumed suspended candidate as completed work', () => {
        const diagnostics = new RuntimeDiagnostics(0, true);
        const run = () => (function* () { yield 1; return 2; })();
        const iterator = diagnostics.run(() => observeCompilerSource(site, 'generator-loop', 'execute', run, undefined, true));
        expect(diagnostics.compilerExecution['generator-loop'].completed).toBe(0);
        iterator.next();
        expect(diagnostics.compilerExecution['generator-loop'].completed).toBe(0);
        iterator.next();
        expect(diagnostics.compilerExecution['generator-loop'].own.compiled).toBe(1);
    });
    it('preserves values, effects and admission with counters, timing and tracing', () => {
        const source = `use io
fun N work
 N print
 return N * N
end
Total = 0
for I in 1 to 20
 Total += I work
end
Total`;
        const execute = (diagnostics?: RuntimeDiagnostics) => {
            const output: string[] = [], code: string[] = [];
            const runtime = new Interpreter(value => output.push(value), {
                onFunctionBodyCompiled: source => code.push(source),
                onBlockCompiled: source => code.push(source),
                onScalarCompiled: source => code.push(source),
                onIntegerLoopCompiled: source => code.push(source),
            });
            try {
                const run = () => {
                    const value = runtime.execute(source);
                    return value === undefined ? undefined : formatValue(value);
                };
                return { value: diagnostics ? diagnostics.run(run) : run(), output, code };
            } finally { runtime.dispose(); }
        };
        const reference = execute();
        for (const diagnostics of [new RuntimeDiagnostics(), new RuntimeDiagnostics(64, false, true), new RuntimeDiagnostics(64, true, true)]) {
            expect(execute(diagnostics)).toEqual(reference);
            if (diagnostics.profileCompiler) expect(Object.keys(diagnostics.compilerPreparation).length).toBeGreaterThan(0);
        }
    });
});
