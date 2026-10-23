import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(checkout|samples|worker|kernel)=(.+)$/.exec(arg);
    if (!match) throw Error(`Unknown option: ${arg}`);
    return [match[1], match[2]];
}));
assert(['sphere', 'sum'].includes(options.kernel ?? 'sphere'));
const root = resolve(options.checkout ?? fileURLToPath(new URL('..', import.meta.url)));
if (options.worker) {
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter();
    if (options.worker === 'sum') {
        runtime.execute('Counts = array shape 19531251 fill 2147483647');
        global.gc();
        const start = performance.now();
        const answer = runtime.execute('Counts sum');
        const ms = performance.now() - start;
        assert.equal(answer, 19531251n * 2147483647n);
        console.log(JSON.stringify({ ms, answer: String(answer), memory: process.memoryUsage(),
            maxRssKiB: process.resourceUsage().maxRSS }));
        runtime.dispose();
        process.exit(0);
    }
    const source = readFileSync(resolve(root, 'demos/euler/360_sphere.ra'), 'utf8').split('Answer =')[0].replace('use io', '');
    runtime.execute(source);
    const sphere = radius => runtime.variables.get('sphere').call([radius]);
    for (const radius of [1n, 5n, 25n, 125n]) {
        assert.equal(sphere(radius), runtime.variables.get('brute').call([radius]));
    }
    global.gc();
    const start = performance.now();
    const answer = sphere(9765625n) * 1024n;
    const ms = performance.now() - start;
    assert.equal(answer, 878825614395267072n);
    const memory = process.memoryUsage();
    const maxRssKiB = process.resourceUsage().maxRSS;
    // Diagnostics are a separate pass, outside the timed measurement.
    const diagnostics = new RuntimeDiagnostics();
    assert.equal(diagnostics.run(() => sphere(78125n)), 54972413910n);
    runtime.dispose();
    console.log(JSON.stringify({ ms, answer: String(answer), memory, maxRssKiB,
        numberLoops: diagnostics.numberLoops, overflows: diagnostics.numberLoopOverflows,
        typedUnpacks: diagnostics.typedUnpacks }));
} else {
    const samples = Number(options.samples ?? 3);
    assert(Number.isSafeInteger(samples) && samples >= 3);
    const results = [];
    for (let i = 0; i < samples; i++) {
        const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url),
            `--checkout=${root}`, `--worker=${options.kernel ?? 'sphere'}`], { encoding: 'utf8', timeout: 30000 });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        results.push(JSON.parse(child.stdout));
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(JSON.stringify({ checkout: root, revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirty: Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()), node: process.version, cpu: cpus()[0].model,
        kernel: options.kernel ?? 'sphere',
        timing: 'fresh processes; sphere: parse excluded, small-radius checks before timing; sum: prepared 19,531,251-cell array',
        samples: results, medianMs: median(results.map(result => result.ms)),
        medianMaxRssMiB: median(results.map(result => result.maxRssKiB)) / 1024,
        medianRssAfterMiB: median(results.map(result => result.memory.rss)) / 2 ** 20,
    }, null, 2));
}
