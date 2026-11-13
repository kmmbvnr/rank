import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter, RuntimeDiagnostics, isRankArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const { typedArray, readArrayItem } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const size = Number(process.argv[2] ?? 1048576), mode = process.env.MODE ?? 'product';
const input = Int32Array.from({ length: size }, (_, i) => (i * 2347 + 17) % 1000000007);
const runtime = new Interpreter(), diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
runtime.variables.set('Input', typedArray(input));
try {
    const body = mode === 'control' ? 'Acc + Value' : `(Acc ${mode === 'sum' ? '+' : '*'} Value) mod Mod`;
    const source = `use sequences\nMod = 1000000007\nfun Acc combine Value = ${body}\nAnswer = Input${process.env.REVERSE ? ' reverse' : ''} scan combine`;
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const used = process.cpuUsage(cpu);
    const result = { size, mode, reversed: !!process.env.REVERSE, ms: performance.now() - start,
        cpuMs: (used.user + used.system) / 1000, maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, ...(diagnostics && { diagnostics }) };
    const answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    assert.ok(answer && isRankArray(answer));
    let expected;
    for (let i = 0; i < size; i++) {
        const value = BigInt(input[process.env.REVERSE ? size - 1 - i : i]);
        expected = i === 0 ? value : mode === 'control' ? expected + value
            : ((mode === 'sum' ? expected + value : expected * value) % 1000000007n);
        assert.equal(readArrayItem(answer, i), expected);
    }
    console.log(JSON.stringify(result));
} finally { runtime.dispose(); }
