import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const mode = process.argv[2] ?? 'roots', size = 65536;
const runtime = new Interpreter(() => {}), diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
try {
    runtime.execute(`use numbers\nInput = 1 to ${size} array`);
    const source = mode === 'roots' ? `Square' = Input * Input
Root' = Square isqrt
Hit' = Root equal Input
Exact' = Hit integer
Clipped' = (Root - 2) max 0
Mask' = (Clipped greater 0) integer
Terms' = Exact * Mask + Clipped
Answer = Terms sum` : `Terms' = Input * 3 + 1\nAnswer = Terms sum`;
    const cpu = process.cpuUsage(), start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const ms = performance.now() - start, used = process.cpuUsage(cpu), maxRssMiB = process.resourceUsage().maxRSS / 1024;
    let expected = 0n;
    for (let i = 1n; i <= BigInt(size); i++) expected += mode === 'roots' ? (i > 2n ? i - 1n : 0n) : 3n * i + 1n;
    assert.equal(runtime.variables.get('Answer'), expected);
    console.log(JSON.stringify({ mode, size, ms, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB, node: process.version, arch: process.arch, ...(diagnostics && { diagnostics }) }));
} finally { runtime.dispose(); }
