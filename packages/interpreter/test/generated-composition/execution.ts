import { isDeepStrictEqual } from 'node:util';
import { Interpreter, RuntimeDiagnostics, RankError, type RankValue } from '../../src/index.js';
import { print, type Program, type Transformation } from './grammar.js';

function snapshot(value: RankValue | undefined): unknown {
    if (value === undefined) return { kind: 'void' };
    if (typeof value === 'bigint') return { kind: 'integer', value: String(value) };
    if (typeof value !== 'object') return { kind: typeof value, value };
    switch (value.kind) {
        case 'array': return { kind: value.kind, shape: [...value.shape], items: value.items.map(snapshot) };
        case 'record': return { kind: value.kind, entries: [...value.entries].map(([key, item]) => [key, snapshot(item)]) };
        case 'queue': case 'tuple': return { kind: value.kind, items: value.items.map(snapshot) };
        default: throw new Error(`Generated grammar returned an unhandled value: ${value.kind}`);
    }
}
export function execute(source: string, compilation: boolean, trace = false) {
    const output: string[] = [];
    const diagnostics = new RuntimeDiagnostics(32, trace);
    const runtime = new Interpreter(text => output.push(text), { compilation, sourceId: 'generated.ra' });
    let value: unknown, error: string | undefined;
    try {
        diagnostics.run(() => {
            try { value = snapshot(runtime.execute(source)); }
            catch (cause) {
                error = cause instanceof RankError ? cause.message
                    : `Host error: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
            }
        });
        return { outcome: { value, error, output }, diagnostics };
    } finally { runtime.dispose(); }
}
export interface Failure { kind: string; transformation: Transformation; source: string; reference: unknown; actual: unknown }
export function check(program: Program, run: typeof execute = execute): { failure?: Failure; compiledEntries: number } {
    const source = print(program), reference = run(source, false);
    // Never silently count invalid generated programs as successful parity.
    if (reference.outcome.error) return { compiledEntries: 0, failure: { kind: 'invalid-generator', transformation: 'none', source,
        reference: reference.outcome, actual: reference.outcome } };
    let compiledEntries = 0;
    for (const transformation of ['none', 'helper', 'local'] as const) {
        const candidate = print(program, transformation);
        let ordinaryCounters: Record<string, number> | undefined;
        for (const [compilation, trace] of [[false, false], [true, false], [true, true]] as const) {
            const actual = run(candidate, compilation, trace);
            compiledEntries += actual.diagnostics.compiledLoops + actual.diagnostics.compiledFramedFunctions
                + actual.diagnostics.numberFunctions + actual.diagnostics.compiledTensors + actual.diagnostics.compiledValueBlocks;
            const counters = Object.fromEntries(Object.entries(actual.diagnostics).filter(([key, value]) =>
                typeof value === 'number' && !key.startsWith('compiler'))) as Record<string, number>;
            if (compilation && !trace) ordinaryCounters = counters;
            if (trace && !isDeepStrictEqual(ordinaryCounters, counters)) return { compiledEntries, failure: {
                kind: 'instrumentation:admission', transformation, source: candidate, reference: ordinaryCounters, actual: counters,
            } };
            if (!isDeepStrictEqual(reference.outcome, actual.outcome)) return { compiledEntries, failure: {
                kind: `${transformation === 'none' ? 'differential' : 'metamorphic'}:${compilation ? trace ? 'trace' : 'compiled' : 'reference'}:${actual.outcome.error ? 'error' : !isDeepStrictEqual(reference.outcome.output, actual.outcome.output) ? 'effects' : 'value'}`,
                transformation, source: candidate, reference: reference.outcome, actual: actual.outcome,
            } };
        }
    }
    return { compiledEntries };
}
