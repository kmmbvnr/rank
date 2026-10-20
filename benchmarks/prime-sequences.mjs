// Build first. --baseline=/absolute/path/to/out/index.js adds the old runtime.
// Each timed sample runs in a fresh process; startup and execute are separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const cases = [
    { name: 'direct-membership', source: `use sequences
Answer = 0
for N in 0 till 1000000
  if N in primes
    Answer += 1
  end
end`, expected: 78498n },
    { name: 'count-50M', source: 'use sequences\nAnswer = primes till 50000000 len', expected: 3001134n },
    { name: '136-original', source: load('./fixtures/136-singleton-materialized.ra'), expected: 2544559n },
    { name: '136-simplified', source: load('../demos/euler/136_singleton.ra'), expected: 2544559n },
    { name: 'bounded-membership', source: 'use sequences\nAnswer = ((0 till 1000000) in (primes till 1000000)) count', expected: 78498n },
    { name: 'huge-start', source: 'use sequences\nAnswer = primes from 10 ** 18 take 2 array',
        expected: '1000000000000000003 1000000000000000009' },
];
if (option('worker')) {
    const entry = cases.find(x => x.name === option('worker'));
    assert.ok(entry);
    const { Interpreter, formatValue } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const runtime = new Interpreter(() => {}), start = performance.now();
    try {
        runtime.execute(entry.source);
        const executeMs = performance.now() - start;
        const result = runtime.variables.get('Answer');
        assert.equal(typeof entry.expected === 'bigint' ? result : formatValue(result), entry.expected);
        console.log(JSON.stringify({ case: entry.name, executeMs, result: String(entry.expected) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), selected = option('cases')?.split(',');
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timings: 'fresh processes; execute includes parsing; cold includes imports and disposal' }));
    for (const entry of cases.filter(x => !selected || selected.includes(x.name))) {
        const variants = [['candidate', undefined], ...(option('baseline') ? [['baseline', option('baseline')]] : [])];
        for (const [variant, runtime] of variants) {
            const samples = [];
            for (let trial = 0; trial < trials; trial++) {
                const start = performance.now();
                const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url),
                    `--worker=${entry.name}`, ...(runtime ? [`--runtime=${runtime}`] : [])], { encoding: 'utf8', timeout: 120000 });
                const coldMs = performance.now() - start;
                assert.ifError(result.error);
                assert.equal(result.status, 0, result.stderr);
                const sample = { ...JSON.parse(result.stdout), variant, trial, coldMs };
                samples.push(sample); console.log(JSON.stringify(sample));
            }
            const median = key => samples.map(x => x[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
            const summary = { case: entry.name, variant, medianExecuteMs: median('executeMs'), medianColdMs: median('coldMs') };
            console.log(JSON.stringify(summary));
            if (entry.name === 'count-50M' && variant === 'candidate') assert.ok(summary.medianExecuteMs < 1500, '50M acceptance target');
        }
    }
}
