// Each mode gets a fresh process. Timings never install compiler source hooks.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { platform, arch, cpus } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { cases } from './compiler-evidence-cases.mjs';

const modes = ['reference', 'plain', 'counters', 'profile', 'trace'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const [action, ...args] = process.argv.slice(2);
if (action === '--worker') {
    const [root, name, mode] = args;
    const { Interpreter, RuntimeDiagnostics, RankError, parse, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
    const diagnostics = () => mode === 'plain' || mode === 'reference' ? undefined
        : new RuntimeDiagnostics(128, mode === 'trace', mode === 'profile' || mode === 'trace');
    const program = parse(cases[name]);
    const samples = { fresh: [], prepared: [] };
    let expected;
    const create = (hooks = {}) => {
        const output = [];
        return { output, runtime: new Interpreter(text => output.push(text), {
            compilation: mode !== 'reference', sourceId: `${name}.ra`, ...hooks,
        }) };
    };
    const run = (state, stats) => {
        state.output.length = 0;
        const execute = () => {
            try {
                const value = state.runtime.executeProgram(program);
                return { value: value === undefined ? null : formatValue(value), output: [...state.output] };
            }
            catch (error) {
                if (!(error instanceof RankError)) throw error;
                return { error: error.format(), output: [...state.output] };
            }
        };
        return stats ? stats.run(execute) : execute();
    };
    const check = outcome => {
        expected ??= outcome;
        if (!isDeepStrictEqual(outcome, expected)) throw new Error('Repeated execution changed observable behavior');
    };
    const prepared = create();
    for (const kind of ['fresh', 'prepared']) {
        for (let trial = 0; trial < 7; trial++) {
            const state = kind === 'fresh' ? create() : prepared, stats = diagnostics();
            const start = performance.now();
            const outcome = run(state, stats);
            samples[kind].push(performance.now() - start);
            check(outcome);
            if (kind === 'fresh') state.runtime.dispose();
        }
    }
    prepared.runtime.dispose();
    // Read memory before any source-hook/admission probe. This process includes
    // warmups and the chosen instrumentation mode, but no other mode/reference.
    const memory = { peakRssKiB: process.resourceUsage().maxRSS, ...process.memoryUsage() };
    const state = create(), stats = diagnostics();
    check(run(state, stats));
    state.runtime.dispose();
    const counters = stats && Object.fromEntries(Object.entries(stats).filter(([key, value]) =>
        typeof value === 'number' && !key.startsWith('compiler')));
    const evidence = stats && { counters, execution: stats.compilerExecution,
        preparation: stats.compilerPreparation, fallbacks: stats.fallbacks,
        fallbackCategories: stats.fallbackCategories, knownWork: stats.costs,
        observationsOmitted: stats.compilerObservationsOmitted,
        rejectionsOmitted: stats.compilerRejectionsOmitted,
        observations: stats.compilerObservations };
    // Hooks can affect admission. This separate probe compares identical hooks
    // across modes; counters additionally compare production runs without hooks.
    const code = [], record = source => code.push(source);
    const probe = create({ onFunctionBodyCompiled: record, onBlockCompiled: record,
        onScalarCompiled: record, onIntegerLoopCompiled: record });
    check(run(probe, diagnostics()));
    probe.runtime.dispose();
    console.log(JSON.stringify({ name, mode, sourceHash: hash(cases[name]), outcome: expected,
        samples, memory, evidence, hookedSources: { count: code.length, hash: hash(code) } }));
} else {
    const root = resolve(action ?? '.'), output = args[0] ?? '/tmp/compiler-evidence.json';
    const pairs = Number(args[1] ?? 3), names = args.slice(2).length ? args.slice(2) : Object.keys(cases);
    if (!Number.isSafeInteger(pairs) || pairs < 1 || names.some(name => !(name in cases))) throw new Error('Invalid pairs or cases');
    const revision = process.env.RANK_EVIDENCE_REVISION ? { status: 0, stdout: process.env.RANK_EVIDENCE_REVISION }
        : spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    if (revision.status !== 0) throw new Error(revision.stderr);
    const report = { schema: 1, revision: revision.stdout.trim(), host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
        protocol: 'Independent mode/case/pair processes, reversed order each pair. Seven samples, discard first two. Timing excludes parsing, construction, disposal and source hooks. Fresh execution includes lazy preparation. RSS includes warmups for this mode. Preparation self time excludes nested observed preparation; it is not all compiler/V8 cost. Entries are overlapping backend calls, never coverage percentages.',
        samples: [], checks: [] };
    for (let pair = 0; pair < pairs; pair++) for (const name of names) {
        const group = [];
        for (const mode of pair % 2 ? [...modes].reverse() : modes) {
            const child = spawnSync(process.execPath, [import.meta.filename, '--worker', root, name, mode], { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
            if (child.error || child.status !== 0) throw new Error(`${name}/${mode}: ${child.error ?? child.stderr}`);
            const sample = { pair, ...JSON.parse(child.stdout) };
            group.push(sample); report.samples.push(sample);
        }
        const reference = group.find(row => row.mode === 'reference');
        const plain = group.find(row => row.mode === 'plain');
        const counters = group.find(row => row.mode === 'counters');
        const checks = {
            pair, name,
            correctness: group.every(row => isDeepStrictEqual(row.outcome, reference.outcome)),
            hookedAdmission: group.filter(row => row.mode !== 'reference').every(row => isDeepStrictEqual(row.hookedSources, plain.hookedSources)),
            counterAdmission: group.filter(row => row.evidence).every(row => isDeepStrictEqual(row.evidence.counters, counters.evidence.counters)),
        };
        report.checks.push(checks);
        writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        if (!checks.correctness || !checks.hookedAdmission || !checks.counterAdmission) throw new Error(`Evidence mismatch: ${JSON.stringify(checks)}; report: ${output}`);
        console.error(`${pair + 1}/${pairs}: ${name} verified`);
    }
}
