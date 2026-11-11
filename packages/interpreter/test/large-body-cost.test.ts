import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, RankError } from '../src/index.js';

function run(source: string, compilation: boolean, trace = false) {
    const output: string[] = [], diagnostics = new RuntimeDiagnostics(Infinity, trace);
    const runtime = new Interpreter(value => output.push(value), { compilation, sourceId: 'large-body.ra' });
    let value: string | undefined, error: string | undefined;
    try {
        diagnostics.run(() => {
            try {
                const result = runtime.execute(source);
                value = result === undefined ? undefined : formatValue(result);
            } catch (cause) {
                if (!(cause instanceof RankError)) throw cause;
                error = cause.format();
            }
        });
        return { outcome: { value, error, output }, diagnostics };
    } finally { runtime.dispose(); }
}
const updates = ' N += 1\n'.repeat(300);
describe('large compiled body cost choices', () => {
    it('retains compiled fragments without binding scalar updates as tensors', () => {
        const source = `use io\nfun N work\n${updates} N print\n return N\nend\n1 work`;
        const reference = run(source, false), compiled = run(source, true), traced = run(source, true, true);
        expect(compiled.outcome).toEqual(reference.outcome);
        expect(traced.outcome).toEqual(reference.outcome);
        expect(compiled.outcome.value).toBe('301');
        expect(compiled.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
        expect(compiled.diagnostics.fallbacks['tensor:scalar-destination-cost']).toBe(300);
        expect(compiled.diagnostics.fallbacks['tensor:output-shape']).toBeUndefined();
        expect(traced.diagnostics.compiledFramedFunctions).toBe(compiled.diagnostics.compiledFramedFunctions);
        expect(traced.diagnostics.compilerObservations.some(entry => entry.backend === 'tensor'
            && entry.outcome === 'declined' && entry.reasons.includes('tensor:scalar-destination-cost'))).toBe(true);
    });
    it('rechecks each invocation and still compiles array updates after scalar calls', () => {
        const source = `use io\nuse sequences\nfun N work\n${updates} N print\n return N\nend\nFirst = 1 work\nSecond = (array shape 4096 fill 2) work\nThird = 1.5 work\ntuple First (Second sum) Third`;
        const reference = run(source, false), compiled = run(source, true);
        expect(compiled.outcome).toEqual(reference.outcome);
        expect(compiled.outcome.error).toBeUndefined();
        expect(compiled.diagnostics.compiledTensors).toBeGreaterThan(0);
        expect(compiled.diagnostics.fallbacks['tensor:scalar-destination-cost']).toBeGreaterThanOrEqual(600);
    });
    it.each(['9007199254740991', '9223372036854775808'])('keeps exact integer results above %s', input => {
        const source = `use io\nfun N work\n${updates} N print\n return N\nend\n${input} work`;
        const reference = run(source, false), compiled = run(source, true);
        expect(compiled.outcome).toEqual(reference.outcome);
        expect(compiled.outcome.value).toBe(String(BigInt(input) + 300n));
    });
    it('preserves mutation-protection errors and the effects before them', () => {
        const source = `use io\nfun N work\n N print\n${' N += 1\n'.repeat(150)} Saved' = N * 2\n${' N += 1\n'.repeat(150)} Saved print\n return N\nend\n1 work`;
        const reference = run(source, false);
        expect(reference.outcome.error).toContain('read-only');
        expect(run(source, true).outcome).toEqual(reference.outcome);
        expect(run(source, true, true).outcome).toEqual(reference.outcome);
    });
    it('skips scalar pointwise rebinding but retains explicit scalar reductions', () => {
        const source = `use sequences\nN = 1\n${'N = (N * 3 + 7) mod 1000000007\n'.repeat(300)}Values = array shape 4096 fill 3\nTotal = 0\nTotal = (Values * 2) sum\ntuple N Total`;
        const reference = run(source, false), compiled = run(source, true, true);
        expect(compiled.outcome).toEqual(reference.outcome);
        expect(compiled.outcome.error).toBeUndefined();
        expect(compiled.diagnostics.fallbacks['tensor:scalar-destination-cost']).toBe(300);
        expect(compiled.diagnostics.compiledTensors).toBeGreaterThan(0);
    });
    it('delegates scalar/array operand mismatches to the normal contract path', () => {
        const source = 'fun N work\n N += array 1 2\n return N\nend\n1 work';
        expect(run(source, true).outcome).toEqual(run(source, false).outcome);
    });
});
