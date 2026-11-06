// Fresh process per timing sample; build before running.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const bottles = Number(process.argv[2] ?? 10000);
let source = readFileSync(process.env.RANK_SOURCE ?? new URL('../demos/euler/726_fallingbottles.ra', import.meta.url), 'utf8')
    .replace('arg Bottles integer = 10000', `Bottles = ${bottles}`);
for (const [before, label] of [['Facts = (1 to Top) scan mulp', 'ratios'],
    ['Chosen = Facts (Triangle - 1)', 'factorials'], ['Terms = Chosen * Powers mod Prime', 'gather'],
    ['Answer = Terms sum mod Prime', 'weights']]) {
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
}, { compilation: process.argv[3] !== 'reference', ...(process.env.SAVE_CODE && {
    onIntegerLoopCompiled: value => code.push(value), onTensorKernelCompiled: value => code.push(value) }) });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(); last = start;
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    const expected = new Map([[1, '1'], [2, '7'], [3, '1015'], [10000, '578040951']]);
    if (expected.has(bottles)) assert.equal(answer, expected.get(bottles));
    console.log(JSON.stringify({ bottles, answer, ms: performance.now() - start, maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, phases, ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
    if (process.env.SAVE_CODE) writeFileSync(process.env.SAVE_CODE, code.join('\n/* region */\n'));
} finally { session.disconnect(); runtime.dispose(); }
