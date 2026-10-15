// Build both runtimes first, then: node benchmarks/queens-membership.mjs --baseline=/path/to/checkout
// A directory containing out/index.js (a saved interpreter build) is also accepted.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(baseline|samples|source)=(.+)$/.exec(arg);
    if (!match) throw Error(`Unknown option: ${arg}`);
    return [match[1], match[2]];
}));
assert(options.baseline, 'Provide --baseline pointing to a built baseline');
const samples = Number(options.samples ?? 15);
assert(Number.isSafeInteger(samples) && samples >= 3);
const baseline = resolve(options.baseline);
const entry = existsSync(resolve(baseline, 'packages/interpreter/out/index.js'))
    ? resolve(baseline, 'packages/interpreter/out/index.js') : resolve(baseline, 'out/index.js');
const versions = {
    before: await import(pathToFileURL(entry)),
    after: await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js'))),
};
const input = readFileSync(options.source ? resolve(options.source) : resolve(root, 'demos/classic/queens.ra'), 'utf8');
const source = options.source ? input : input.split('States len print')[0] + 'States copy\n';
const report = {
    node: process.version, cpu: cpus()[0]?.model, samples, warmups: 5, baseline, gcBetweenRuns: Boolean(global.gc),
    revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()),
    source, sourceHash: createHash('sha256').update(source).digest('hex'),
    policy: 'Fresh interpreter per execution; time parse, search and materialization of all 92x8 cells, excluding initialization, validation, display and printing. Alternate variant order; warm both runtimes.',
    results: [],
};
let expected;
for (const compilation of [false, true]) {
    const times = { before: [], after: [] };
    for (let i = -report.warmups; i < samples; i++) {
        for (const name of i % 2 ? ['before', 'after'] : ['after', 'before']) {
            global.gc?.();
            const runtime = new versions[name].Interpreter(() => {}, { compilation });
            try {
                const start = performance.now();
                const result = runtime.execute(source);
                const elapsed = performance.now() - start;
                assert.deepEqual(result.shape, [92, 8]);
                expected ??= [...result.items];
                assert.deepEqual(result.items, expected);
                if (i >= 0) times[name].push(elapsed);
            } finally { runtime.dispose(); }
        }
    }
    const median = values => {
        const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const before = median(times.before), after = median(times.after);
    report.results.push({ compilation, times, before, after, ratio: after / before });
    console.error(`${compilation ? 'compiled' : 'reference'}: ${before.toFixed(1)} -> ${after.toFixed(1)} ms`);
}
console.log(JSON.stringify(report, null, 2));
