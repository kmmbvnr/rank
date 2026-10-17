// Build each checkout with npx tsc -b tsconfig.build.json first.
// Compare --root /path/to/built/checkout; --case array isolates the issue repro.
// Timings are fresh-process measurements, never a CI assertion.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const option = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
};
const root = resolve(option('--root', resolve(import.meta.dirname, '..')));
const header = `use linalg
use numbers
use sequences
use io
Limit = 60000
Modulus = 1000000
Root = Limit isqrt
K = 1 to Root array
Odd = K mod 2 * 2 - 1
Low = K * (3 * K - 1) // 2
High = K * (3 * K + 1) // 2
Size = K len * 2
Gens = stack Low High transpose
Gen = Gens reshape Size
Signs = stack Odd Odd transpose
Sign = Signs reshape Size
`;
// Keep the original 488-entry generator, padding and complete algorithm fixed.
const array = `${header}Ways = array shape (Limit + Gen max + 1) fill 0
Ways Limit = 1
Answer = -1
for N in 1 to Limit
  Base = Limit - N
  Total = (Ways (Gen + Base)) Sign matmul
  Ways Base = Total mod Modulus
  if Ways Base equal 0
    Answer = N
    break
  end
end
Answer print`;
const scalar = `${header}Ways = array shape (Limit + 1) fill 0
Ways 0 = 1
Answer = -1
for N in 1 to Limit
  Total = 0
  for J in 0 till Size
    G = Gen J
    if G greater N
      break
    end
    Total += Sign J * Ways (N - G)
  end
  Ways N = Total mod Modulus
  if Ways N equal 0
    Answer = N
    break
  end
end
Answer print`;
const cases = {
    scalar: [scalar, 55374n], array: [array, 55374n],
    euler76: ['076_countsums.ra', 190569291n],
    euler77: ['077_primesummations.ra', 71n],
    euler78: ['078_coinpartitions.ra', 55374n],
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (process.argv.includes('--worker')) {
    const name = option('--worker');
    const { Interpreter } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')).href);
    const runtime = new Interpreter(() => {});
    try {
        const [input, expected] = cases[name];
        const source = input.endsWith('.ra') ? readFileSync(resolve(root, 'demos/euler', input), 'utf8') : input;
        const start = performance.now();
        runtime.execute(source);
        const executeMs = performance.now() - start;
        assert.equal(runtime.variables.get('Answer'), expected);
        console.log(JSON.stringify({ executeMs, maxRSSMiB: process.resourceUsage().maxRSS / 1024 }));
    } finally { runtime.dispose(); }
} else {
    const names = option('--case') ? option('--case').split(',') : Object.keys(cases);
    const results = {};
    for (const name of names) {
        const samples = [];
        for (let run = 0; run < Number(option('--runs', '3')); run++) {
            const start = performance.now();
            const worker = spawnSync(process.execPath,
                [import.meta.filename, '--root', root, '--worker', name], { encoding: 'utf8' });
            const processMs = performance.now() - start;
            assert.equal(worker.status, 0, worker.stderr);
            samples.push({ processMs, ...JSON.parse(worker.stdout) });
        }
        results[name] = { samples, medianProcessMs: median(samples.map(s => s.processMs)),
            medianExecuteMs: median(samples.map(s => s.executeMs)),
            medianMaxRSSMiB: median(samples.map(s => s.maxRSSMiB)) };
        console.error(`${name}: ${results[name].medianProcessMs.toFixed(1)} ms process, ${results[name].medianExecuteMs.toFixed(1)} ms execute`);
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, root, results }, null, 2));
}
