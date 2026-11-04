import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const count = 200000, wide = 9007199254740993n;
const cases = {
    routing: [`use sequences
T = 0 till ${count} array
V' = concat ((T * ${wide}) shift 1 with -1) (T * ${wide})
K = array shape ${2 * count} fill 0
(V sum by K) sum`, BigInt(count - 1) ** 2n * wide - 1n],
    stored: [`use sequences
V = array shape ${count} fill 1
K = array shape ${count} fill 0
(V sum by K) sum`, BigInt(count)],
    entries: [`use algo
fun N remember_value Store
 Store add N
 return N
end
Seen = new set
Total = 0
for I in 1 to 10000
 Total += I remember_value Seen
end
Total`, 50005000n],
};
if (process.argv[2] === '--worker') {
    const [, , , checkout, name, engine, diagnostics] = process.argv;
    const { Interpreter, RuntimeDiagnostics, parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter(() => {}, { compilation: engine === 'compiled', integerLoopCompilation: false });
    const program = parse(cases[name][0]);
    const stats = diagnostics === 'on' ? new RuntimeDiagnostics() : undefined;
    global.gc();
    const start = performance.now();
    const result = stats ? stats.run(() => runtime.executeProgram(program)) : runtime.executeProgram(program);
    const milliseconds = performance.now() - start;
    assert.equal(result, cases[name][1]);
    global.gc();
    const memory = process.memoryUsage();
    console.log(JSON.stringify({ milliseconds, peakRssKiB: process.resourceUsage().maxRSS,
        retainedHeap: memory.heapUsed, retainedBuffers: memory.arrayBuffers,
        keyedReaders: stats?.keyedNativeReaders, publishedCells: stats?.typedArrayPublishedCells }));
    runtime.dispose();
} else {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
    if (!baseline) throw new Error('Pass --baseline=/path/to/built/checkout');
    const observations = [];
    for (const name of Object.keys(cases)) for (const engine of ['reference', 'compiled']) {
        for (let sample = 0; sample < 4; sample++) {
            for (const [version, checkout] of (sample % 2 ? [['candidate', root], ['baseline', baseline]] : [['baseline', baseline], ['candidate', root]])) {
                const diagnostics = sample === 3 ? 'on' : 'off';
                const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', checkout, name, engine, diagnostics],
                    { encoding: 'utf8', timeout: 120000 });
                if (child.status !== 0) throw new Error(child.stderr || String(child.error));
                observations.push({ name, engine, version, diagnostics, sample, ...JSON.parse(child.stdout) });
            }
        }
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, observations }, null, 2));
}
