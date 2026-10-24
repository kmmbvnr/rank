import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const match = /^--(case|samples|worker|size|checkout)=(.+)$/.exec(argument);
    assert(match, `Unknown option: ${argument}`);
    return [match[1], match[2]];
}));
const root = resolve(options.checkout ?? fileURLToPath(new URL('..', import.meta.url)));
const testCase = options.case ?? 'euler';
if (options.worker) {
    const { Interpreter } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
    const { typedArray, readArrayItem, denseScalarItems } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/array-storage.js')));
    const runtime = new Interpreter(() => {});
    const size = Number(options.size ?? 50005000);
    assert(Number.isSafeInteger(size) && size > 1);
    let source;
    if (testCase !== 'euler') {
        const buffer = new BigInt64Array(size);
        const words = new Uint32Array(buffer.buffer);
        let seed = 123456;
        for (let i = 0; i < size; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            words[2 * i] = seed;
            words[2 * i + 1] = seed & 0x3ffff;
        }
        runtime.variables.set('A', typedArray(buffer));
        runtime.execute('A = A');
        if (testCase === 'conversion') {
            runtime.execute('Flags = A greater 100000000000000');
            source = 'Ints = Flags integer';
        } else if (testCase === 'slice') source = `S = A (1 till ${size} array)`;
        else if (testCase === 'sort') source = 'use sequences\nA = A sort';
        else throw Error(`Unknown case: ${testCase}`);
    } else {
        assert.equal(size, 50005000, 'The Euler case uses default N=10000; --size is for microbenchmarks');
        source = readFileSync(resolve(root, 'demos/euler/557_cuttingtriangles.ra'), 'utf8');
    }
    const start = performance.now();
    runtime.execute(source);
    const ms = performance.now() - start;
    if (testCase === 'euler') assert.equal(runtime.variables.get('Answer'), 2699929328n);
    else {
        const name = testCase === 'sort' ? 'A' : testCase === 'slice' ? 'S' : 'Ints';
        const result = runtime.variables.get(name);
        assert.equal(result.shape[0], testCase === 'slice' ? size - 1 : size);
        if (testCase === 'sort') {
            const cells = denseScalarItems(result);
            for (let i = 1; i < size; i++) assert(cells[i - 1] <= cells[i]);
        } else for (const i of [0, 1, Math.floor((size - 1) / 2), size - 2]) {
            assert.equal(readArrayItem(result, i), testCase === 'slice'
                ? readArrayItem(runtime.variables.get('A'), i + 1)
                : readArrayItem(runtime.variables.get('Flags'), i) ? 1n : 0n);
        }
    }
    console.log(JSON.stringify({ testCase, size, ms, peakMiB: process.resourceUsage().maxRSS / 1024,
        buffersMiB: process.memoryUsage().arrayBuffers / 2 ** 20, node: process.version, checked: true }));
    runtime.dispose();
} else {
    const samples = Number(options.samples ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    for (let i = 0; i < samples; i++) {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker=true',
            `--checkout=${root}`, `--case=${testCase}`, `--size=${options.size ?? 50005000}`],
        { encoding: 'utf8', timeout: 180000 });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        console.log(result.stdout.trim());
    }
}
