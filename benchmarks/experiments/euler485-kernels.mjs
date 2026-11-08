import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK485_RUNTIME;
const base = chosen ? pathToFileURL(chosen) : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { typedArray, derivedArray, readArrayItem, writeIntegerSelection } = await import(new URL('array-storage.js', base));
const { registerScalarView } = await import(new URL('integer-view.js', base));
const { materializeSelectedView } = await import(new URL('array-copy.js', base));
const [mode = '+='] = process.argv.slice(2), count = 1048576, repeats = 12;
const times = [], startCpu = process.cpuUsage();
if (['+=', '-=', '*='].includes(mode)) {
    const source = typedArray(new Int32Array(3 * count).fill(1));
    const scalar = mode === '*=' ? 1n : 2n;
    for (let r = 0; r < repeats; r++) {
        const start = performance.now();
        writeIntegerSelection(source, count, i => 3 * i, scalar, mode, { offset: 0, stride: 3 });
        times.push(performance.now() - start);
    }
    const expected = mode === '*=' ? 1n : mode === '+=' ? 25n : -23n;
    if (readArrayItem(source, 3 * (count - 1)) !== expected) throw Error('Wrong scalar write');
} else {
    const cells = mode === 'gather-int64' ? BigInt64Array.from({ length: 3 * count }, (_, i) => (1n << 56n) + BigInt(i))
        : mode === 'gather-real' ? Float64Array.from({ length: 3 * count }, (_, i) => i + 0.25)
            : Int32Array.from({ length: 3 * count }, (_, i) => i);
    const source = typedArray(cells), offset = 3 * (count - 1), stride = -3;
    const at = i => offset + i * stride;
    const view = registerScalarView(derivedArray([count], [source], i => readArrayItem(source, at(i)), true), source, at,
        { regular: true, linear: () => ({ offset, stride }) });
    for (let r = 0; r < repeats; r++) {
        const start = performance.now(), result = materializeSelectedView(view);
        times.push(performance.now() - start);
        if (!result || readArrayItem(result, count - 1) !== readArrayItem(source, 0)) throw Error('Wrong affine copy');
    }
}
const ordered = times.slice(2).sort((a, b) => a - b);
console.log(JSON.stringify({ mode, count, repeats, node: process.version, arch: process.arch,
    times, medianMs: (ordered[4] + ordered[5]) / 2, cpu: process.cpuUsage(startCpu),
    rssMiB: process.resourceUsage().maxRSS / 1024 }));
