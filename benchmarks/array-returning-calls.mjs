// Build each runtime first. Compare --runtime=/path/to/packages/interpreter/out/index.js.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const n = Number(option('n') ?? 20000), trials = Number(option('trials') ?? 3);
assert.ok(Number.isSafeInteger(n) && n > 0);
assert.ok(Number.isInteger(trials) && trials > 0);
const runtimePath = resolve(option('runtime') ?? fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url)));
const source = `use sequences
fun A N advance
 B = array shape 23 fill 0
 for J in 0 till 23
  B J = ((A J) * 100000007 + N + J) mod 1000000007
 end
 return B
end
A = array shape 23 fill 1
for I in 1 to ${n}
 A = A I advance
end
Answer = A sum`;

if (process.argv.includes('--worker')) {
    const { Interpreter } = await import(pathToFileURL(runtimePath).href);
    let loops = 0;
    const entries = process.argv.includes('--entries');
    const runtime = new Interpreter(() => {}, entries ? { onIntegerLoopExecuted: () => loops++ } : {});
    try {
        const start = performance.now(), cpu = process.cpuUsage();
        runtime.execute(source);
        const executeMs = performance.now() - start, usage = process.cpuUsage(cpu);
        // Independent native arithmetic checks every cell after the timed region.
        const cells = Array(23).fill(1n);
        for (let i = 1; i <= n; i++) for (let j = 0; j < cells.length; j++) {
            cells[j] = (cells[j] * 100000007n + BigInt(i + j)) % 1000000007n;
        }
        assert.deepEqual([...runtime.variables.get('A').items], cells);
        const answer = cells.reduce((a, b) => a + b, 0n);
        assert.equal(runtime.variables.get('Answer'), answer);
        console.log(JSON.stringify({ n, executeMs, cpuMs: (usage.user + usage.system) / 1000,
            maxRssKiB: process.resourceUsage().maxRSS, answer: String(answer),
            compiledLoops: entries ? loops : undefined,
            sourceSha256: createHash('sha256').update(source).digest('hex') }));
    } finally { runtime.dispose(); }
} else {
    const entries = process.argv.includes('--entries');
    const runtimes = new Map(option('baseline')
        ? [['baseline', resolve(option('baseline'))], ['candidate', runtimePath]] : [['candidate', runtimePath]]);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtimes: Object.fromEntries(runtimes), entries,
        timings: 'fresh sequential processes, alternating order; execution includes parsing and setup; oracle excluded' }));
    const samples = new Map([...runtimes.keys()].map(name => [name, []]));
    for (let trial = 0; trial < trials; trial++) {
        const order = [...runtimes];
        for (const [name, runtime] of trial % 2 ? order.reverse() : order) {
            const start = performance.now();
            const worker = spawnSync(process.execPath, [import.meta.filename, '--worker', `--n=${n}`, `--runtime=${runtime}`, ...(entries ? ['--entries'] : [])],
                { encoding: 'utf8', timeout: 120000 });
            assert.ifError(worker.error);
            assert.equal(worker.status, 0, worker.stderr);
            const sample = { name, trial, processMs: performance.now() - start, ...JSON.parse(worker.stdout) };
            samples.get(name).push(sample); console.log(JSON.stringify(sample));
        }
    }
    for (const [name, values] of samples) {
        const median = key => values.map(sample => sample[key]).sort((a, b) => a - b)[Math.floor(values.length / 2)];
        console.log(JSON.stringify({ name, n, samples: values.length, medianExecuteMs: median('executeMs'),
            medianProcessMs: median('processMs'), medianCpuMs: median('cpuMs'), medianMaxRssKiB: median('maxRssKiB') }));
    }
}
