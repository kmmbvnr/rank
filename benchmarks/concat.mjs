// node --expose-gc benchmarks/concat.mjs [--samples=3] [--sizes=1000,10000,100000]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';

const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const kind = options.kind ?? 'array';
assert(['array', 'sequence'].includes(kind));
if (options.worker) {
    const n = Number(options.worker), compilation = options.compiled === 'true';
    const runtime = new Interpreter(() => {}, { compilation });
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const measurements = {};
    const measure = (name, code, expected) => {
        const start = performance.now();
        try {
            const result = runtime.execute(code);
            if (expected !== undefined) assert.equal(result, expected);
            measurements[name] = { ms: performance.now() - start };
        } catch (error) {
            if (error.code === 'ERR_ASSERTION') throw error;
            measurements[name] = { ms: performance.now() - start, error: error.message };
        }
    };
    measure('build', `use sequences\nA = ${kind === 'array' ? 'array shape 0 fill 0' : '0 till 0'}\nfor I in 0 till ${n}\n A = concat A ${kind === 'array' ? '(array I)' : '(I to I)'}\nend`);
    global.gc?.();
    const builtHeapMiB = (process.memoryUsage().heapUsed - before) / 2 ** 20;
    measure('length', 'A len', BigInt(n));
    measure('first', 'A 0', 0n);
    measure('last', `A ${n - 1}`, BigInt(n - 1));
    const indexes = Array.from({ length: 1000 }, (_, i) => (i * 7919) % n);
    if (kind === 'array') measure('random', `Indexes = array ${indexes.join(' ')}\nTotal = 0\nfor I in Indexes\n Total += A I\nend\nTotal`, indexes.reduce((sum, i) => sum + BigInt(i), 0n));
    measure('traverse', 'Total = 0\nfor X in A\n Total += X\nend\nTotal', BigInt(n) * BigInt(n - 1) / 2n);
    global.gc?.();
    console.log(JSON.stringify({ n, kind, compilation, measurements, builtHeapMiB,
        retainedHeapMiB: (process.memoryUsage().heapUsed - before) / 2 ** 20,
        peakRssMiB: process.resourceUsage().maxRSS / 1024 }));
    runtime.dispose();
} else {
    const results = [];
    for (const n of (options.sizes ?? '1000,10000,100000').split(',').map(Number)) {
        for (const compilation of [false, true]) for (let sample = 0; sample < Number(options.samples ?? 3); sample++) {
            const child = spawnSync(process.execPath, ['--expose-gc', import.meta.filename,
                `--worker=${n}`, `--compiled=${compilation}`, `--kind=${kind}`], { encoding: 'utf8', timeout: 180000 });
            if (child.status !== 0) throw Error(child.stderr || String(child.error || child.signal));
            const result = JSON.parse(child.stdout);
            if (options['require-success'] === 'true') {
                for (const measurement of Object.values(result.measurements)) assert.equal(measurement.error, undefined);
            }
            results.push({ sample, ...result });
            console.error(`${n} compiled=${compilation} sample=${sample + 1}`);
        }
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, results }, null, 2));
}
