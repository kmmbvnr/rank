// Build with npx tsc -b tsconfig.build.json first. Timings are not CI gates.
// Profile one worker with node --cpu-prof benchmarks/modular-recurrence.mjs --worker=lazy --diagnostics.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const modes = ['lazy', 'copy', 'stored', 'stored-exact'];
const digits = Number(option('digits') ?? 9999);
const expected = new Map([[0, 96149360n], [2, 24806056n], [5, 30808124n], [9999, 96972774n]]);
assert.ok(expected.has(digits), '--digits must be 0, 2, 5 or 9999');
const runtimePath = resolve(option('runtime') ?? fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url)));

if (option('worker')) {
    const mode = option('worker');
    assert.ok(modes.includes(mode));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath).href);
    let source = readFileSync(new URL('../demos/euler/324_tower.ra', import.meta.url), 'utf8')
        .replace('5 * 10 ** 9999', `5 * 10 ** ${digits}`);
    assert.ok(source.includes('C = C copy\n'));
    assert.ok(source.includes('return (P take K) copy'));
    if (mode === 'lazy' || mode === 'copy') source = source.replace('C = C copy\n', '');
    if (mode === 'lazy') source = source.replace('return (P take K) copy', 'return P take K');
    const runtime = new Interpreter(() => {}, mode === 'stored-exact' ? { numberLoopCompilation: false } : {});
    const diagnostics = process.argv.includes('--diagnostics') ? new RuntimeDiagnostics() : undefined;
    try {
        const cpu = process.cpuUsage(), start = performance.now();
        if (diagnostics) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start, usage = process.cpuUsage(cpu);
        const answer = runtime.variables.get('Answer');
        assert.equal(answer, expected.get(digits));
        console.log(JSON.stringify({ mode, digits, executeMs, cpuMs: (usage.user + usage.system) / 1000,
            maxRssKiB: process.resourceUsage().maxRSS, answer: String(answer),
            sourceSha256: createHash('sha256').update(source).digest('hex'), diagnostics }));
    } finally { runtime.dispose(); }
} else {
    const selected = option('modes')?.split(',') ?? modes;
    assert.ok(selected.length && selected.every(mode => modes.includes(mode)));
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout') ?? 120000);
    assert.ok(Number.isInteger(trials) && trials > 0);
    assert.ok(Number.isInteger(timeout) && timeout > 0);
    const diagnostics = process.argv.includes('--diagnostics');
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtimePath,
        timings: 'fresh sequential processes; execution includes parsing and setup; diagnostic runs are separate', diagnostics }));
    const samples = new Map(selected.map(mode => [mode, []]));
    for (let trial = 0; trial < trials; trial++) {
        for (const mode of trial % 2 ? [...selected].reverse() : selected) {
            const start = performance.now();
            const worker = spawnSync(process.execPath, [import.meta.filename, `--worker=${mode}`,
                `--digits=${digits}`, `--runtime=${runtimePath}`, ...(diagnostics ? ['--diagnostics'] : [])],
            { encoding: 'utf8', timeout });
            assert.ifError(worker.error);
            assert.equal(worker.status, 0, worker.stderr);
            const sample = { trial, processMs: performance.now() - start, ...JSON.parse(worker.stdout) };
            samples.get(mode).push(sample);
            console.log(JSON.stringify(sample));
        }
    }
    for (const [mode, values] of samples) {
        const median = key => values.map(value => value[key]).sort((a, b) => a - b)[Math.floor(values.length / 2)];
        console.log(JSON.stringify({ mode, digits, samples: values.length,
            medianExecuteMs: median('executeMs'), medianCpuMs: median('cpuMs'),
            medianProcessMs: median('processMs'), medianMaxRssKiB: median('maxRssKiB') }));
    }
}
