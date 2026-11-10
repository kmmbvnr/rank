import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { AstUtils } from 'langium';
import { compiledOperators, operations, reflection } from '@arrrank/language';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, parse } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { cases, type CapabilityCase } from './capability-matrix/cases.js';

function execute(row: CapabilityCase, compilation: boolean, trace: boolean) {
    const diagnostics = new RuntimeDiagnostics(Infinity, trace);
    const output: string[] = [];
    const runtime = new Interpreter(value => output.push(String(value)), { compilation, sourceId: `${row.id}.ra` });
    if (row.storage) {
        const values = [1, 2, 3, 4, 5, 6, 7, 8];
        const data = row.storage === 'int32' ? Int32Array.from(values)
            : row.storage === 'int64' ? BigInt64Array.from(values.map(BigInt)) : Float64Array.from(values);
        runtime.variables.set('Values', typedArray(data, [2, 4]));
    }
    let result: string | undefined, error: string | undefined;
    try {
        diagnostics.run(() => {
            try {
                const value = runtime.execute(row.source);
                result = value === undefined ? undefined : formatValue(value);
            } catch (cause) {
                if (!(cause instanceof RankError)) throw cause;
                error = cause.format();
            }
        });
        return { result, error, output, diagnostics };
    } finally { runtime.dispose(); }
}
function summarize(row: CapabilityCase, diagnostics: RuntimeDiagnostics, outcome: { result?: string; error?: string; output: string[] }) {
    const observations = diagnostics.compilerObservations;
    const reasons = [...new Set(observations.flatMap(entry => entry.reasons))].sort();
    return {
        outcome: { ...outcome, category: outcome.error ? 'language-error' : 'completed' },
        source: row.source, storage: row.storage, inputs: row.inputs, result: row.result, ranks: row.ranks, layout: row.layout,
        effects: row.effects, combination: row.combination,
        ast: [...new Set(['Program', ...AstUtils.streamAllContents(parse(row.source)).map(node => node.$type)])].sort(),
        paths: [...new Set(observations.flatMap(entry => entry.execution?.paths ?? []))].sort(),
        provenTypes: observations.filter(entry => entry.provenTypes).map(entry => ({ backend: entry.backend, source: entry.source, types: entry.provenTypes })),
        regions: observations.filter(entry => entry.execution).map(entry =>
            `${entry.source.line}:${entry.source.column} ${entry.backend}: ${entry.execution!.paths.join(', ')}`)
            .filter((entry, index, all) => all.indexOf(entry) === index).sort(),
        reasons,
        boundaries: reasons.map(reason => ({ reason,
            category: /budget|cost|limit/.test(reason) ? 'cost-limit'
                : /guard/.test(reason) ? 'runtime-guard'
                : /unsupported-|generator-function|deferred-binding/.test(reason) ? 'missing-lowering'
                : /proof|callee-binding|required|output-shape|no-wide|no-direct/.test(reason) ? 'failed-proof'
                : /too-small|no-fusible-operation/.test(reason) ? 'cost-limit'
                : 'unclassified' })),
        languageError: row.error === true,
    };
}
const report: Record<string, ReturnType<typeof summarize>> = {};
const demos = [
    ['001_multiples', '233168'], ['002_evenfib', '4613732'],
    ['003_primefactor', '6857'], ['006_sumsquarediff', '25164150'],
] as const;
for (const [name] of demos) cases.push({ id: `euler/${name}`,
    source: readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8'),
    inputs: ['integer'], result: 'printed integer', ranks: [0, 1],
    layout: 'program-dependent', effects: ['io'], combination: name });
describe('executable compiler capability matrix', () => {
    for (const row of cases) it(row.id, () => {
        const reference = execute(row, false, false);
        const plain = execute(row, true, false);
        const traced = execute(row, true, true);
        const observable = ({ result, error, output }: ReturnType<typeof execute>) => ({ result, error, output });
        expect(observable(plain)).toEqual(observable(reference));
        expect(observable(traced)).toEqual(observable(reference));
        if (row.error) expect(traced.error).toBeDefined();
        else expect(traced.error).toBeUndefined();
        for (const counter of ['compiledLoops', 'numberLoops', 'numberFunctions', 'compiledArrayFunctions',
            'compiledNumericCallLoops', 'compiledGeneratorLoops', 'compiledTensors', 'numberTensors',
            'fusedArrayRegions', 'compiledEffectCalls'] as const) {
            expect(traced.diagnostics[counter], counter).toBe(plain.diagnostics[counter]);
        }
        const summary = summarize(row, traced.diagnostics, observable(traced));
        report[row.id] = summary;
        expect(summary.boundaries.filter(entry => entry.category === 'unclassified')).toEqual([]);
        expect({ ...observable(traced), regions: summary.regions, boundaries: summary.boundaries }).toMatchSnapshot();
        if (row.operator) expect(summary.paths.some(path => path === 'number-loop' || path === 'exact-loop')).toBe(true);
        const demo = demos.find(([name]) => row.id === `euler/${name}`);
        if (demo) expect(traced.output.join('\n').trim()).toBe(demo[1]);
    });
    it('reports the current catalogue and explicitly identifies untested AST nodes', () => {
        const matchingCases = (predicate: (row: CapabilityCase) => boolean) => cases.filter(predicate).map(row => row.id);
        const inventory = {
            ast: reflection.getAllTypes().map(name => ({ name, cases: matchingCases(row => report[row.id].ast.includes(name)) })),
            operators: compiledOperators.map(op => ({ ...op, cases: matchingCases(row => row.id.includes(`operator/${op.name}/`)) })),
            builtins: operations.map(({ name, module, signatures, compiledCall, compiledEffects, effects }) =>
                ({ name, module, signatures, compiledCall, compiledEffects, effects,
                    cases: matchingCases(row => row.id.startsWith(`builtin/${name}/`)) })),
        };
        expect(Object.keys(report)).toHaveLength(cases.length);
        expect(new Set(cases.map(row => row.id)).size).toBe(cases.length);
        expect(inventory.ast.filter(row => row.cases.length).length).toBeGreaterThan(10);
        if (process.env.RANK_CAPABILITY_REPORT) writeFileSync(process.env.RANK_CAPABILITY_REPORT,
            JSON.stringify({ note: 'Declarations are not execution evidence. Untested entries remain gaps; no whole-program coverage percentage is inferred.', inventory, cases: report }, null, 2) + '\n');
    });
});
