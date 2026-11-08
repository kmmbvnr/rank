import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK482_RUNTIME;
const url = chosen ? chosen.startsWith('file:') ? new URL(chosen) : pathToFileURL(chosen)
    : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, isRankArray } = await import(url);
const { typedArray, readArrayItem } = await import(new URL('array-storage.js', url));
const size = Number(process.argv[2] ?? 1000000), repeats = Number(process.argv[3] ?? 6), operation = process.argv[4] ?? 'max';
if (!['min', 'max'].includes(operation) || size < 1) throw Error('Expected positive size and min/max');
const r = new Interpreter(() => {}, { compilation: false });
r.variables.set('Input', typedArray(Int32Array.from({ length: size }, (_, i) => i % 97 - 48)));
const source = `Result = Input scan ${operation}`;
try {
    r.execute(source); r.execute(source);
    const start = performance.now(), cpuStart = process.cpuUsage();
    for (let i = 0; i < repeats; i++) r.execute(source);
    const ms = performance.now() - start, result = r.variables.get('Result');
    if (!result || !isRankArray(result)) throw Error('Expected result array');
    for (const i of [0, Math.min(96, size - 1), size - 1]) {
        const expected = operation === 'max' ? Math.min(i, 96) - 48 : -48;
        if (readArrayItem(result, i) !== BigInt(expected)) throw Error('Wrong prefix');
    }
    console.log(JSON.stringify({ runtime: url.href, node: process.version, arch: process.arch, size, repeats, operation,
        ms, cpu: process.cpuUsage(cpuStart), rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { r.dispose(); }
