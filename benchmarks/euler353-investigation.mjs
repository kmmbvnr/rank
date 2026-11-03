import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

if (process.env.RANK353_TRUSTED_LOAD === '1') {
    await import('./experiments/euler353-trusted-load-prototype.mjs');
}
const { Interpreter, RuntimeDiagnostics, isRankArray } = await import(
    process.env.RANK353_RUNTIME || new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const [file = 'demos/euler/353_riskymoon.ra', mode = 'compiled', last = '15',
    phase = 'full', radius = '32767', diag = ''] = process.argv.slice(2);
const output = [], kernels = [];
let scalarCalls = 0, bodyCalls = 0;
const runtime = new Interpreter(text => output.push(text.trim()), {
    compilation: mode !== 'reference', args: phase === 'full' ? [`--last=${last}`] : [],
    ...(diag ? {
        onScalarFunctionExecuted: () => scalarCalls++, onFunctionBodyExecuted: () => bodyCalls++,
        onIntegerLoopCompiled: source => kernels.push(source),
    } : {}),
});
const diagnostics = new RuntimeDiagnostics();
try {
    const source = readFileSync(file, 'utf8');
    if (phase !== 'full') runtime.execute(source.split('\nSum =')[0]);
    const start = performance.now(), cpu = process.cpuUsage();
    const run = () => runtime.execute(phase === 'full' ? source : `Result = ${radius} ${phase}`);
    if (diag) diagnostics.run(run); else run();
    let value = runtime.variables.get(phase === 'full' ? 'Answer' : 'Result');
    if (isRankArray(value)) value = { shape: value.shape };
    if (typeof value === 'bigint') value = String(value);
    const expected = { 5: 1.1091333145, 9: 1.2388476315, 15: 1.2759860331 }[last];
    if (phase === 'full' && expected !== undefined) assert.equal(value, expected);
    console.log(JSON.stringify({ file, mode, last, phase, radius, node: process.version, arch: process.arch,
        ms: performance.now() - start, cpuMs: Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b) / 1000,
        rssMiB: process.resourceUsage().maxRSS / 1024, value, output,
        ...(diag ? { diagnostics, scalarCalls, bodyCalls } : {}),
    }));
    if (diag && process.env.RANK353_KERNEL_OUTPUT) writeFileSync(process.env.RANK353_KERNEL_OUTPUT, kernels.join('\n\n'));
} finally { runtime.dispose(); }
