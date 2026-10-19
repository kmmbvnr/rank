import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, type RankValue } from '../src/index.js';
import { MemoryIo, TokenInput } from './support.js';

const demos = resolve(import.meta.dirname, '../../../demos');
function programs(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = resolve(directory, entry.name);
        return entry.isDirectory() ? programs(file) : file.endsWith('.ra') ? [file] : [];
    }).sort();
}
// Full comparisons over the time/resource budget remain excluded (issues #311, #316).
const tooSlow = new RegExp('^euler/(?:' + [
    '150_subtriangle(?:_default_test)?',
    '154_pascalpyramid',
    '155_capacitors',
    '165_intersections',
    '170_pandigitalproducts(?:_test)?',
    '177_quadrilaterals(?:_test)?',
    '179_consecutivedivisors',
    '185_numbermind(?:_test)?',
    '186_connectedness(?:_test)?',
    '193_squarefree',
    '196_primetriplets(?:_test)?',
    '198_ambiguous(?:_test)?',
    '210_obtuse',
    '224_almostright',
    '250_subsets(?:_test)?',
    '266_pseudosquareroot',
    '268_fourprimes',
].join('|') + ')\\.ra$');
const sources = new Map(programs(demos).map(file => [file, readFileSync(file, 'utf8')]));

// Snapshot eager values without forcing lazy streams or calling user functions.
// Their consumption is covered by the program's output and embedded test results.
function snapshot(value: RankValue | undefined, active = new Set<object>()): unknown {
    if (value === undefined || typeof value !== 'object') return value;
    if (active.has(value)) return '<cycle>';
    active.add(value);
    try {
        const item = (value: RankValue) => snapshot(value, active);
        switch (value.kind) {
            case 'array': return { kind: value.kind, shape: value.shape, items: value.items.map(item) };
            case 'tuple': case 'queue': return { kind: value.kind, items: value.items.map(item) };
            case 'record': return { kind: value.kind, entries: [...value.entries].map(([name, value]) => [name, item(value)]) };
            case 'bytes': return { kind: value.kind, data: [...value.data] };
            case 'label': return { kind: value.kind, name: value.name };
            case 'function': return { kind: value.kind, name: value.name, arities: value.arities };
            case 'sequence': return { kind: value.kind, size: value.plan.size };
            default: return { kind: value.kind };
        }
    } finally { active.delete(value); }
}

function run(file: string, compilation: boolean) {
    const output: string[] = [], environment = new Map<string, string>();
    const io = new MemoryIo({}), input = new TokenInput([]);
    let seed = 12345, entries = 0;
    const executed = () => entries++;
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(text => output.push(text), {
        compilation, sourceId: file, testing: true, io, input,
        environment: { get: name => environment.get(name), set: (name, value) => {
            if (value === undefined) environment.delete(name); else environment.set(name, value);
        } },
        random: () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32),
        loadModule: (specifier, fromId) => {
            const id = resolve(dirname(fromId ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            const source = sources.get(id);
            if (source === undefined) throw new Error(`No corpus module: ${relative(demos, id)}`);
            return { id, source };
        },
        onScalarExecuted: executed, onBlockExecuted: executed,
        onScalarFunctionExecuted: executed, onTensorKernelExecuted: executed, onFunctionBodyExecuted: executed,
    });
    let value: unknown, error: string | undefined;
    try { value = snapshot(diagnostics.run(() => runtime.execute(sources.get(file)!))); }
    catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
    finally { runtime.dispose(); }
    return { entries: entries + diagnostics.compiledLoops, numberEntries: diagnostics.numberLoops, observation: { value, error, output, environment: [...environment],
        files: [...io.files], closed: io.handles.map(handle => handle.closed), inputReads: input.reads,
        tests: runtime.testResults.map(({ durationMs: _, ...result }) => result),
    } };
}

describe('compiled and reference demo execution', () => {
    const count = Number(process.env.RANK_DIFFERENTIAL_SHARDS ?? 1);
    const shard = Number(process.env.RANK_DIFFERENTIAL_SHARD ?? 0);
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(shard) || shard < 0 || shard >= count) {
        throw new Error('Invalid differential shard');
    }
    const files = [...sources.keys()].filter(file => !tooSlow.test(relative(demos, file))).filter(file =>
        createHash('sha256').update(relative(demos, file)).digest().readUInt32BE(0) % count === shard);
    let compared = 0, completed = 0, tests = 0, entries = 0, numberEntries = 0;
    for (const file of files) it(relative(demos, file), async () => {
        console.log(`comparing ${relative(demos, file)}`);
        const reference = run(file, false), compiled = run(file, true);
        await setImmediate();
        expect(reference.entries).toBe(0);
        expect(compiled.observation).toEqual(reference.observation);
        compared++;
        completed += Number(!compiled.observation.error);
        tests += compiled.observation.tests.length;
        entries += compiled.entries;
        numberEntries += compiled.numberEntries;
    }, 300_000);
    afterAll(() => {
        console.log(`differential: ${compared}/${files.length} compared, ${completed} completed, ${tests} test blocks, ${entries} compiled entries, ${numberEntries} Number loop entries`);
        if (compared !== files.length) return; // A name-filtered run reports only selected fixtures.
        const summary = process.env.RANK_DIFFERENTIAL_SUMMARY;
        if (summary) writeFileSync(summary, JSON.stringify({ shard, count, files: files.map(file => relative(demos, file)), completed, tests, entries, numberEntries }));
        expect(completed).toBeGreaterThan(0);
        expect(entries).toBeGreaterThan(0);
        if (count === 1) {
            expect(compared).toBe([...sources.keys()].filter(file => !tooSlow.test(relative(demos, file))).length);
            expect(completed).toBeGreaterThan(400);
            expect(tests).toBeGreaterThan(100);
            expect(numberEntries).toBeGreaterThan(0);
        }
    });
});
