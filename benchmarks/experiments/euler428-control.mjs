import { readFileSync } from 'node:fs';
const runtimeUrl = process.env.RANK428_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics } = await import(runtimeUrl);
const { typedArray } = await import(process.env.RANK428_STORAGE ?? new URL('./array-storage.js', runtimeUrl));
const stage = readFileSync('demos/classic/fft.ra', 'utf8').split('rem Radix-2')[0];
const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
try {
    runtime.execute(stage + '\nfun Count rangeTotal\n Keys = 1 to Count copy\n Values = 3 * Keys - 7\n return Values sum\nend');
    const fn = runtime.variables.get('fftStage'), range = runtime.variables.get('rangeTotal'), n = 64;
    const data = phase => typedArray(Float64Array.from({ length: n }, (_, i) => Math.sin(i * .71 + phase)));
    const args = [data(0), data(.37), typedArray(Float64Array.from({ length: n / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / n))),
        typedArray(Float64Array.from({ length: n / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / n))), BigInt(n)];
    for (let i = 0; i < 1000; i++) fn.call(args);
    range.call([1000000n]);
    let start = performance.now();
    for (let i = 0; i < 20000; i++) diagnostics.run(() => fn.call(args));
    const fftMs = performance.now() - start;
    start = performance.now();
    for (let i = 0; i < 20; i++) if (diagnostics.run(() => range.call([1000000n])) !== 1499994500000n) throw Error('wrong affine sum');
    console.log(JSON.stringify({ fftMs, fftCalls: 20000, affineMs: performance.now() - start, affineCalls: 20,
        rssMiB: process.resourceUsage().maxRSS / 1024, diagnostics }));
} finally { runtime.dispose(); }
