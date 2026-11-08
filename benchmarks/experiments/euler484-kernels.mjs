import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK484_RUNTIME;
const url = chosen ? chosen.startsWith('file:') ? new URL(chosen) : pathToFileURL(chosen)
    : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, isRankArray } = await import(url);
const { typedArray, readArrayItem } = await import(new URL('array-storage.js', url));
const mode = process.argv[2] ?? 'sum-vector', size = 1048576, repeats = 3;
if (!['sum-vector', 'sum-matrix', 'compare'].includes(mode)) throw Error('Unknown probe');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'compare' });
const base = 1n << BigInt(mode === 'compare' ? 54 : 42);
const input = new BigInt64Array(size), words = new Int32Array(input.buffer);
const low = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;
const high = Number(base >> 32n);
for (let i = 0; i < size; i++) { words[2 * i + low] = i % 100; words[2 * i + 1 - low] = high; }
let expected = 0n;
try {
    const shape = mode === 'sum-matrix' ? [1024, 1024] : [size];
    runtime.variables.set('Input', typedArray(input, shape));
    let source;
    if (mode === 'compare') {
        const other = new BigInt64Array(size), packed = new Int32Array(other.buffer);
        for (let i = 0; i < size; i++) {
            const tail = i % 100 + i % 3 - 1;
            packed[2 * i + low] = tail;
            packed[2 * i + 1 - low] = high + (tail < 0 ? -1 : 0);
        }
        runtime.variables.set('Other', typedArray(other));
        source = 'Result = Input at least Other';
    } else {
        const weights = new Int32Array(mode === 'sum-matrix' ? 1024 : size).fill(3);
        runtime.variables.set('Weight', typedArray(weights));
        const blocks = Math.floor(size / 100), rest = size % 100;
        expected = (base * BigInt(size) + BigInt(blocks * 4950 + rest * (rest - 1) / 2)) * 3n;
        source = "Values' = Input * Weight\nResult = Values sum";
    }
    runtime.execute(source); runtime.execute(source);
    const start = performance.now(), cpuStart = process.cpuUsage();
    for (let i = 0; i < repeats; i++) runtime.execute(source);
    const ms = performance.now() - start, cpu = process.cpuUsage(cpuStart), result = runtime.variables.get('Result');
    if (mode === 'compare') {
        if (!result || !isRankArray(result)) throw Error('Expected mask');
        for (const i of [0, 1, 2, 31, 32, size - 1]) if (readArrayItem(result, i) !== (i % 3 < 2)) throw Error('Wrong mask');
    } else if (result !== expected) throw Error('Wrong exact sum');
    console.log(JSON.stringify({ runtime: url.href, node: process.version, arch: process.arch, mode, size, repeats,
        ms, cpu, rssMiB: process.resourceUsage().maxRSS / 1024, answer: mode === 'compare' ? 'mask checked' : String(result) }));
} finally { runtime.dispose(); }
