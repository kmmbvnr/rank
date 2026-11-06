import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter, RuntimeDiagnostics, isRankArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const { typedArray, readArrayItem } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const size = Number(process.argv[2] ?? 1048576);
const input = Float64Array.from({ length: size }, (_, i) => i + 1000001);
const runtime = new Interpreter();
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
runtime.variables.set('Input', typedArray(input));
try {
    const source = `use numbers
use sequences
Estimate' = Input log + 0.5772156649015329 + 0.5 / Input
Harm' = Estimate - 1.0 / (12.0 * Input * Input)
Ratio' = (Input / Harm - 0.25) sqrt
Angles' = Ratio / (Input + 0.5)
Answer = Angles atan copy`;
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const used = process.cpuUsage(cpu);
    const result = { size, ms: performance.now() - start, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch,
        ...(diagnostics && { diagnostics }) };
    const answer = runtime.variables.get('Answer');
    assert.ok(isRankArray(answer));
    for (let i = 0; i < size; i++) {
        const coin = input[i], harmonic = Math.log(coin) + 0.5772156649015329 + 0.5 / coin - 1 / (12 * coin * coin);
        assert.equal(readArrayItem(answer, i), Math.atan(Math.sqrt(coin / harmonic - 0.25) / (coin + 0.5)));
    }
    console.log(JSON.stringify(result));
} finally { runtime.dispose(); }
