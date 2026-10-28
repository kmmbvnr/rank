// Build first. Compare the unchanged Euler 320 source against a built checkout:
// node benchmarks/factorial-valuations.mjs --baseline=/path/to/packages/interpreter/out/index.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const cases = new Map([
    [1000, 614538266565663n],
    [100000, 172360737804266019n],
    [1000000, 278157919195482643n],
]);
if (option('worker')) {
    const upper = Number(option('worker'));
    assert.ok(cases.has(upper));
    const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const source = readFileSync(new URL('../demos/euler/320_factorials.ra', import.meta.url), 'utf8')
        .replace('arg Upper integer = 1000000', `arg Upper integer = ${upper}`);
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const cpu = process.cpuUsage(), start = performance.now();
    try {
        if (option('diagnostics')) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start, usage = process.cpuUsage(cpu);
        const answer = runtime.variables.get('Answer');
        assert.equal(answer, cases.get(upper));
        console.log(JSON.stringify({ upper, executeMs, cpuMs: (usage.user + usage.system) / 1000,
            maxRssKiB: process.resourceUsage().maxRSS, answer: String(answer),
            ...(option('diagnostics') ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout') ?? 120000);
    assert.ok(Number.isInteger(trials) && trials > 0 && Number.isInteger(timeout) && timeout > 0);
    const selected = option('cases')?.split(',').map(Number) ?? [...cases.keys()];
    assert.ok(selected.length && selected.every(upper => cases.has(upper)));
    const variants = option('baseline') ? ['baseline', 'current'] : ['current'];
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, baseline: option('baseline'),
        timings: 'fresh processes; execution includes parsing, compilation, sieve construction and search; diagnostics disabled unless requested' }));
    for (const upper of selected) {
        const samples = new Map(variants.map(name => [name, []]));
        for (let trial = 0; trial < trials; trial++) {
            for (const variant of trial % 2 ? [...variants].reverse() : variants) {
                const runtime = variant === 'baseline' ? option('baseline') : undefined;
                const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${upper}`,
                    ...(runtime ? [`--runtime=${runtime}`] : []), ...(option('diagnostics') ? ['--diagnostics=true'] : [])],
                { encoding: 'utf8', timeout });
                assert.ifError(result.error);
                assert.equal(result.status, 0, result.stderr);
                const sample = { variant, trial, ...JSON.parse(result.stdout) };
                samples.get(variant).push(sample);
                console.log(JSON.stringify(sample));
            }
        }
        for (const [variant, values] of samples) {
            const median = key => values.map(value => value[key]).sort((a, b) => a - b)[Math.floor(values.length / 2)];
            console.log(JSON.stringify({ upper, variant, medianExecuteMs: median('executeMs'),
                medianCpuMs: median('cpuMs'), medianMaxRssKiB: median('maxRssKiB') }));
        }
    }
}
