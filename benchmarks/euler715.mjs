// Fresh process per sample. RANK_ROOT selects a built checkout.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const limit = Number(process.argv[2] ?? 1e12);
const compilation = process.argv[3] !== 'reference';
let source = readFileSync(process.env.RANK_SOURCE ?? new URL('../demos/euler/715_sextupletnorms.ra', import.meta.url), 'utf8')
    .replace('arg Limit integer = 10 ** 12', `Limit = ${limit}`);
for (const [before, label] of [['for P in Primes', 'setup'], ['Gap = CubeLow - ChiLow', 'sieve'],
    ['rem Smaller primes:', 'large-primes'], ['Answer = (1 + SumBig 1) mod Prime', 'small-primes']]) {
    source = source.replace(before, `"stage:${label}" print\n${before}`);
}
const phases = [], code = [];
let last = performance.now();
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
const runtime = new Interpreter(value => {
    const text = String(value).replaceAll('"', '');
    if (!text.startsWith('stage:')) return;
    const now = performance.now(), memory = process.memoryUsage();
    const phase = { stage: text.slice(6), ms: now - last, rssMiB: memory.rss / 2 ** 20,
        heapMiB: memory.heapUsed / 2 ** 20, buffersMiB: memory.arrayBuffers / 2 ** 20 };
    phases.push(phase); console.log(JSON.stringify(phase)); last = now;
}, { compilation, ...(process.env.SAVE_CODE && { onIntegerLoopCompiled: value => code.push(value) }) });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(); last = start;
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const ms = performance.now() - start, answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const expected = new Map([[10, '3053'], [100000, '157612967'], [1e12, '883188017']]);
    if (expected.has(limit)) assert.equal(answer, expected.get(limit));
    console.log(JSON.stringify({ limit, compilation, answer, ms, maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, phases, ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
    if (process.env.SAVE_CODE) writeFileSync(process.env.SAVE_CODE, code.join('\n/* region */\n'));
} finally { session.disconnect(); runtime.dispose(); }
