// Build first. Baseline is the original Euler 302 program on the same runtime.
// --baseline=/path/to/out/index.js compares the repeated workload with an older runtime.
// --runtime=/path/to/out/index.js selects the runtime for the other variants.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const cases = [
    { name: 'prime-minus-one', expected: 5856434400n, source: `use numbers
use sequences
Answer = 0
for Repeat in 1 to 3
    for P in primes till 1000000
        Answer += (P - 1) factors sum
    end
end` },
    { name: 'euler-1e8', limit: '100000000', expected: 656n },
    { name: 'euler-1e12', limit: '1000000000000', expected: 16176n },
    { name: 'euler-1e18', limit: '1000000000000000000', expected: 1170060n },
];
if (option('worker')) {
    const entry = cases.find(x => x.name === option('worker'));
    assert.ok(entry);
    const { Interpreter } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const source = (entry.source ?? load(option('variant') === 'manual'
        ? './fixtures/302-strongachilles-manual.ra' : '../demos/euler/302_strongachilles.ra'))
        .replace('arg Limit integer = 10 ** 18', `arg Limit integer = ${entry.limit}`);
    const runtime = new Interpreter(() => {}), cpu = process.cpuUsage(), start = performance.now();
    try {
        runtime.execute(source);
        const executeMs = performance.now() - start, usage = process.cpuUsage(cpu);
        const result = runtime.variables.get('Answer');
        assert.equal(result, entry.expected);
        console.log(JSON.stringify({ case: entry.name, variant: option('variant'), executeMs,
            cpuMs: (usage.user + usage.system) / 1000, maxRssKiB: process.resourceUsage().maxRSS,
            answer: String(result), sourceLines: source.trimEnd().split('\n').length }));
    } finally { runtime.dispose(); }
} else {
    const timeoutMs = Number(option('timeout') ?? 600000);
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0);
    const trials = Number(option('trials') ?? 3), selected = option('cases')?.split(',');
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtime: option('runtime') ?? 'current', baseline: option('baseline'),
        timings: 'fresh processes; execution includes parsing, table construction and search' }));
    for (const entry of cases.filter(x => !selected || selected.includes(x.name))) {
        const available = entry.source
            ? option('baseline') ? ['trial', 'builtin'] : ['builtin']
            : ['manual', 'builtin'];
        const variants = option('variants')?.split(',') ?? available;
        assert.ok(variants.length && variants.every(variant => available.includes(variant)));
        const samples = new Map(variants.map(variant => [variant, []]));
        for (let trial = 0; trial < trials; trial++) {
            // Alternate order to reduce temperature and background-load bias.
            for (const variant of trial % 2 ? [...variants].reverse() : variants) {
                const runtime = variant === 'trial' ? option('baseline') : option('runtime');
                const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url),
                    `--worker=${entry.name}`, `--variant=${variant}`,
                    ...(runtime ? [`--runtime=${runtime}`] : [])],
                { encoding: 'utf8', timeout: timeoutMs });
                if (result.error?.code === 'ETIMEDOUT') {
                    console.log(JSON.stringify({ case: entry.name, variant, trial, status: 'timeout', timeoutMs }));
                    process.exitCode = 1;
                    continue;
                }
                assert.ifError(result.error);
                assert.equal(result.status, 0, result.stderr);
                const sample = { ...JSON.parse(result.stdout), trial };
                samples.get(variant).push(sample); console.log(JSON.stringify(sample));
            }
        }
        for (const [variant, values] of samples) {
            if (!values.length) continue;
            const median = key => values.map(x => x[key]).sort((a, b) => a - b)[Math.floor(values.length / 2)];
            console.log(JSON.stringify({ case: entry.name, variant, medianExecuteMs: median('executeMs'),
                completedSamples: values.length, medianCpuMs: median('cpuMs'), medianMaxRssKiB: median('maxRssKiB') }));
        }
    }
}
