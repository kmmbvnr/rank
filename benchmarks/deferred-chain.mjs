import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Build first. --root=PATH compares the same source and oracle against another
// checkout's built interpreter; every sample runs in a fresh process.
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const root = resolve(option('root', fileURLToPath(new URL('..', import.meta.url))));
const depth = Number(option('depth', '32'));
const size = Number(option('size', '10000'));
const samples = Number(option('samples', '3'));
assert(Number.isSafeInteger(depth) && depth > 0 && depth <= 1000);
assert(Number.isSafeInteger(size) && size > 0);
assert(Number.isSafeInteger(samples) && samples > 0);

if (process.argv.includes('--worker')) {
    const compilation = !process.argv.includes('--reference');
    const { Interpreter, demandValue } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
    const source = 'use sequences\nfun Values total\n'
        + Array.from({ length: depth }, (_, i) => ` Stage${i}' = ${i ? `Stage${i - 1}` : 'Values'} * 2 + 1`).join('\n')
        + `\n Saved = Stage${depth - 1} sum\n return Saved\nend`;
    const n = BigInt(size), factor = 2n ** BigInt(depth);
    const expected = factor * n * (n + 1n) / 2n + (factor - 1n) * n;
    const values = { kind: 'array', shape: [size], items: Array.from({ length: size }, (_, i) => BigInt(i + 1)) };
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        const preparationStart = performance.now();
        runtime.execute(source);
        const total = runtime.variables.get('total');
        assert.equal(total?.kind, 'function');
        const preparationMs = performance.now() - preparationStart;
        global.gc?.();
        const before = process.memoryUsage().heapUsed;
        const start = performance.now();
        const actual = demandValue(total.call([values]));
        const executionMs = performance.now() - start;
        assert.equal(actual, expected);
        global.gc?.();
        console.log(JSON.stringify({ root, depth, size, compilation, preparationMs, executionMs,
            sourceHash: createHash('sha256').update(source).digest('hex'), result: actual.toString(),
            retainedHeapBytes: process.memoryUsage().heapUsed - before,
            peakRssKiB: process.resourceUsage().maxRSS,
        }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, root, depth, size, samples,
        method: 'Fresh processes, one at a time. Preparation separate; complete result inside execution timing. Heap is retained after GC; RSS is the whole process peak.' }));
    const modes = process.argv.includes('--reference') ? [false] : [false, true];
    for (let sample = 0; sample < samples; sample++) for (const compilation of modes) {
        const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker',
            `--root=${root}`, `--depth=${depth}`, `--size=${size}`,
            ...compilation ? [] : ['--reference']], { encoding: 'utf8', timeout: 30_000 });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const measurement = JSON.parse(result.stdout);
        console.log(JSON.stringify({ sample, ...measurement }));
    }
}
