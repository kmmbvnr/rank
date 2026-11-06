// Fresh process per timing sample; build before running.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const limit = Number(process.argv[2] ?? 1000000000000);
const budget = Number(process.argv[3] ?? 16777216);
const original = readFileSync(process.env.RANK_SOURCE ?? new URL('../demos/euler/735_divisorsoftwo.ra', import.meta.url), 'utf8');
let source = original.replace('arg Limit integer = 10 ** 12', `Limit = ${limit}`)
    .replace('arg Budget integer = 16777216', `Budget = ${budget}`);
for (const [before, label] of [['Odds = 1 to Root by 2', 'mobius'], ['Ys = concat YA', 'tasks'],
    ['Total = 0', 'chunks'], ['Answer = Total', 'terms']]) {
    source = source.replace(before, `"stage:${label}" print\n${before}`);
}
const phases = [], code = [], diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
let last = performance.now();
const runtime = new Interpreter(value => {
    const label = String(value).replaceAll('"', '');
    if (!label.startsWith('stage:')) return;
    const now = performance.now(), memory = process.memoryUsage();
    const phase = { stage: label.slice(6), ms: now - last, rssMiB: memory.rss / 2 ** 20,
        heapMiB: memory.heapUsed / 2 ** 20, buffersMiB: memory.arrayBuffers / 2 ** 20 };
    phases.push(phase); console.log(JSON.stringify(phase)); last = now;
}, { compilation: process.argv[4] !== 'reference', ...(process.env.SAVE_CODE && {
    onIntegerLoopCompiled: value => code.push(value), onTensorKernelCompiled: value => code.push(value) }) });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(); last = start;
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    const expected = new Map([[1, '1'], [15, '63'], [1000, '15066'], [1000000000000, '174848216767932']]);
    if (expected.has(limit)) assert.equal(answer, expected.get(limit));
    console.log(JSON.stringify({ limit, budget, answer, terms: String(runtime.variables.get('Final')),
        ms: performance.now() - start, maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, phases, ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
    if (process.env.SAVE_CODE) writeFileSync(process.env.SAVE_CODE, code.join('\n/* region */\n'));
} finally { session.disconnect(); runtime.dispose(); }
