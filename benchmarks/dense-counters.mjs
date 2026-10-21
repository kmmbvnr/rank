// Build first: npx tsc -b tsconfig.build.json.
// node benchmarks/dense-counters.mjs --trials=3
// Profile separately: node --cpu-prof benchmarks/dense-counters.mjs --worker=euler --diagnostics
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const runtimePath = resolve(option('runtime') ?? fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url)));
const cases = ['counters', 'counters-exact', 'euler', 'euler-exact'];
const counterSource = `Seen = array shape 1000000 fill 0
Tail = array shape 1000000 fill 0
for I in 0 till 6000000
 K = I mod 1000000
 Seen K += 1
 Tail K += 1
end`;
const eulerSource = readFileSync(new URL('../demos/euler/326_modulosums.ra', import.meta.url), 'utf8');

if (option('worker')) {
    const name = option('worker');
    assert.ok(cases.includes(name));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath).href);
    const { readArrayItem } = await import(new URL('./array-storage.js', pathToFileURL(runtimePath)).href);
    const runtime = new Interpreter(() => {}, { numberLoopCompilation: !name.endsWith('-exact') });
    const diagnostics = process.argv.includes('--diagnostics') ? new RuntimeDiagnostics() : undefined;
    const source = name.startsWith('counters') ? counterSource : eulerSource;
    try {
        runtime.execute(''); // Initialize the parser before measuring the workload.
        const start = performance.now();
        if (diagnostics) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start;
        const maxRssKiB = process.resourceUsage().maxRSS;
        // Check every counter outside the timed region, without unpacking storage.
        let answer;
        if (name.startsWith('counters')) {
            for (const binding of ['Seen', 'Tail']) {
                const array = runtime.variables.get(binding);
                assert.deepEqual(array.shape, [1000000]);
                for (let i = 0; i < 1000000; i++) assert.equal(readArrayItem(array, i), 6n);
            }
            answer = '12000000';
        } else {
            assert.equal(runtime.variables.get('Answer'), 1966666166408794329n);
            answer = String(runtime.variables.get('Answer'));
        }
        if (diagnostics) {
            assert.equal(diagnostics.typedUnpacks, 0);
            assert.ok(diagnostics.compiledLoops > 0);
            if (name === 'counters') {
                assert.equal(diagnostics.numberLoops, 1);
                assert.equal(diagnostics.numberLoopOverflows, 0);
            }
            if (name.endsWith('-exact')) assert.equal(diagnostics.numberLoops, 0);
        }
        console.log(JSON.stringify({ name, executeMs, maxRssKiB, answer,
            sourceSha256: createHash('sha256').update(source).digest('hex'), diagnostics }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout') ?? 30000);
    assert.ok(Number.isInteger(trials) && trials > 0);
    assert.ok(Number.isInteger(timeout) && timeout > 0);
    const selected = option('cases')?.split(',') ?? cases;
    assert.ok(selected.length && selected.every(name => cases.includes(name)));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtimePath,
        timings: 'fresh sequential processes; alternating case order; parser initialized; execution includes allocation and compilation; counter validation excluded; diagnostics separate' }));
    const samples = new Map(selected.map(name => [name, []]));
    const run = (name, diagnostic) => {
        const start = performance.now();
        const child = spawnSync(process.execPath, [import.meta.filename, `--worker=${name}`, `--runtime=${runtimePath}`,
            ...(diagnostic ? ['--diagnostics'] : [])], { encoding: 'utf8', timeout });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        return { processMs: performance.now() - start, ...JSON.parse(child.stdout) };
    };
    for (let trial = 0; trial < trials; trial++) {
        for (const name of trial % 2 ? [...selected].reverse() : selected) {
            const sample = run(name, false);
            samples.get(name).push(sample);
            console.log(JSON.stringify({ trial, ...sample }));
        }
    }
    for (const [name, values] of samples) {
        const median = key => values.map(value => value[key]).sort((a, b) => a - b)[Math.floor(values.length / 2)];
        console.log(JSON.stringify({ name, samples: values.length, medianExecuteMs: median('executeMs'),
            medianProcessMs: median('processMs'), medianMaxRssKiB: median('maxRssKiB') }));
        console.log(JSON.stringify({ diagnostic: true, ...run(name, true) }));
    }
}
