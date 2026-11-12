import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, parse, type RankFileMode, type RankValue } from '../src/index.js';
import { auditArguments, auditEligible, auditScale, auditSource } from '../../../scripts/demo-audit-inputs.mjs';
import { MemoryIo, TokenInput } from './support.js';

const executionTimeouts: Record<string, number> = JSON.parse(readFileSync(
    new URL('../../../scripts/demo-execution-timeouts.json', import.meta.url), 'utf8'));

const demos = resolve(import.meta.dirname, '../../../demos');
function programs(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = resolve(directory, entry.name);
        return entry.isDirectory() ? programs(file) : file.endsWith('.ra') ? [file] : [];
    }).sort();
}
// Default-scale workloads outside the CI execution budget; small fixtures remain.
const executionExclusions = new Set(Object.keys(JSON.parse(readFileSync(
    new URL('../../../scripts/demo-execution-exclusions.json', import.meta.url), 'utf8'))));
const sources = new Map(programs(demos).map(file => [file, readFileSync(file, 'utf8')]));

const trackedDataFiles = new Set(execFileSync('git', ['ls-files', '-z', '--', 'demos'], {
    cwd: resolve(demos, '..'), encoding: 'utf8',
}).split('\0').filter(Boolean).map(file => resolve(demos, '..', file)));

// Read checked-in demo data on demand; every run keeps its writes in memory.
class CorpusIo extends MemoryIo {
    private mount(path: string): void {
        if (this.files.has(path)) return;
        const file = resolve(demos, '..', path);
        if (!trackedDataFiles.has(file) || !existsSync(file)) return;
        const actual = realpathSync(file);
        if (!actual.startsWith(realpathSync(demos) + sep) || actual.endsWith('.ra') || !statSync(actual).isFile()) return;
        this.files.set(path, new Uint8Array(readFileSync(actual)));
    }

    override file(path: string): Uint8Array {
        this.mount(path);
        return super.file(path);
    }

    override write(path: string, data: Uint8Array, append: boolean): void {
        if (append) this.mount(path);
        super.write(path, data, append);
    }

    override open(path: string, mode: RankFileMode) {
        if (mode === 'append') this.mount(path);
        return super.open(path, mode);
    }
}

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

function run(file: string, compilation: boolean, recordProgress = true) {
    const start = performance.now();
    const summary = recordProgress ? process.env.RANK_DIFFERENTIAL_SUMMARY : undefined;
    const progress = (stage: string, elapsedMs?: number) => {
        if (summary) appendFileSync(`${summary}.progress.jsonl`, JSON.stringify({
            file: relative(demos, file), compilation, stage, elapsedMs,
        }) + '\n');
    };
    progress('start');
    const output: string[] = [], environment = new Map<string, string>();
    const io = new CorpusIo({}), input = new TokenInput([]);
    let seed = 12345;
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(text => output.push(text), {
        compilation, sourceId: file, testing: true, io, input, args: auditArguments(relative(demos, file)),
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
    });
    let value: unknown, error: string | undefined;
    try {
        const source = sources.get(file)!;
        const selected = auditSource(relative(demos, file), source, parse(source, file));
        value = snapshot(diagnostics.run(() => runtime.execute(selected)));
    }
    catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
    finally { runtime.dispose(); }
    const elapsedMs = performance.now() - start;
    progress('complete', elapsedMs);
    // User execution hooks are observers: installing them disables valid
    // production fast paths. Existing passive counters give a lower bound on
    // compiler activity without requesting observer mode.
    const entries = diagnostics.compiledLoops + diagnostics.compiledFunctionFolds
        + diagnostics.compiledGeneratorLoops + diagnostics.numberFunctions + diagnostics.compiledTensors
        + diagnostics.compiledArrayFunctions + diagnostics.compiledNumericCallLoops;
    return { elapsedMs, entries, numberEntries: diagnostics.numberLoops, nativeRangeReductions: diagnostics.modularCallbackReductions, observation: { value, error, output, environment: [...environment],
        files: [...io.files], closed: io.handles.map(handle => handle.closed), inputReads: input.reads,
        tests: runtime.testResults.map(({ durationMs: _, ...result }) => result),
    } };
}

describe('compiled and reference demo execution', () => {
    const count = Number(process.env.RANK_DIFFERENTIAL_SHARDS ?? 1);
    const shard = Number(process.env.RANK_DIFFERENTIAL_SHARD ?? 0);
    const timeout = Number(process.env.RANK_DIFFERENTIAL_TIMEOUT_MS ?? (auditScale === 'small' ? 60_000 : 300_000));
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(shard) || shard < 0 || shard >= count) {
        throw new Error('Invalid differential shard');
    }
    if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('Invalid differential timeout');
    const eligible = [...sources.keys()].filter(file => !executionExclusions.has(relative(demos, file)) && auditEligible(relative(demos, file)));
    const files = eligible.filter(file =>
        createHash('sha256').update(relative(demos, file)).digest().readUInt32BE(0) % count === shard);
    let compared = 0, completed = 0, tests = 0, entries = 0, numberEntries = 0;
    const failures: { file: string; error?: string; tests: { name: string; error?: string }[] }[] = [];
    const outcomes: { file: string; referenceMs: number; compiledMs: number; output?: string[];
        outputChunks: number; tests: number; failedTests: number; error?: string }[] = [];
    for (const file of files) it(relative(demos, file), async () => {
        console.log(`comparing ${relative(demos, file)}`);
        const reference = run(file, false), compiled = run(file, true);
        await setImmediate();
        expect(reference.entries).toBe(0);
        expect(compiled.observation).toEqual(reference.observation);
        // Matching failures are not a passing embedded test file.
        if (file.endsWith('_test.ra')) expect(compiled.observation.error, relative(demos, file)).toBeUndefined();
        if (auditArguments(relative(demos, file)).length) {
            expect(compiled.observation.error, relative(demos, file)).toBeUndefined();
        }
        const failedTests = compiled.observation.tests.filter(result => !result.passed)
            .map(({ name, error }) => ({ name, error }));
        expect(failedTests, relative(demos, file)).toEqual([]);
        if (compiled.observation.error || failedTests.length) {
            failures.push({ file: relative(demos, file), error: compiled.observation.error, tests: failedTests });
        }
        const output = compiled.observation.output;
        outcomes.push({ file: relative(demos, file), referenceMs: reference.elapsedMs, compiledMs: compiled.elapsedMs,
            output: output.length <= 16 && output.every(line => line.length <= 256) ? output : undefined,
            outputChunks: output.length, tests: compiled.observation.tests.length,
            failedTests: failedTests.length, error: compiled.observation.error });
        compared++;
        completed += Number(!compiled.observation.error);
        tests += compiled.observation.tests.length;
        entries += compiled.entries;
        numberEntries += compiled.numberEntries;
    }, auditScale === 'small' || process.env.RANK_DIFFERENTIAL_TIMEOUT_MS !== undefined ? timeout
        : executionTimeouts[relative(demos, file)] ? executionTimeouts[relative(demos, file)] * 2 : timeout);
    afterAll(() => {
        console.log(`differential: ${compared}/${files.length} compared, ${completed} completed, ${tests} test blocks, ${entries} passive compiled entries, ${numberEntries} Number loop entries`);
        if (compared !== files.length) return; // A name-filtered run reports only selected fixtures.
        const summary = process.env.RANK_DIFFERENTIAL_SUMMARY;
        if (summary) writeFileSync(summary, JSON.stringify({ shard, count, entryAccounting: 'passive-diagnostics-v1', files: files.map(file => relative(demos, file)), completed, tests, entries, numberEntries, failures, outcomes }));
        expect(completed).toBeGreaterThan(0);
        expect(entries).toBeGreaterThan(0);
        if (count === 1) {
            expect(compared).toBe(eligible.length);
            expect(completed).toBeGreaterThan(400);
            expect(tests).toBeGreaterThan(100);
            expect(numberEntries).toBeGreaterThan(0);
        }
    });
});

it('does not mount downloaded data outside the checked-in corpus', () => {
    const directory = mkdtempSync(resolve(demos, '.corpus-data-'));
    try {
        const file = resolve(directory, 'input.csv');
        writeFileSync(file, 'Value\n42\n');
        expect(() => new CorpusIo({}).file(relative(resolve(demos, '..'), file)))
            .toThrow('file does not exist');
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('does not install observer hooks when auditing a native range consumer', () => {
    const file = resolve(demos, '.audit-native-range.ra');
    const source = `use sequences
Mod = 100000007
fun Acc combine Value
 return Acc * Value mod Mod
end
Span' = 1 to 10000
Span reduce combine with 1`;
    let expected = 1n;
    for (let i = 1n; i <= 10000n; i++) expected = expected * i % 100000007n;
    expect(sources.has(file)).toBe(false);
    sources.set(file, source);
    try {
        for (const compilation of [false, true]) {
            const result = run(file, compilation, false);
            expect(result.observation.error).toBeUndefined();
            expect(result.observation.value).toBe(expected);
            expect(result.nativeRangeReductions).toBe(1);
        }
    } finally { sources.delete(file); }
});
