// Fresh process per timing sample; build before running.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const shifts = Number(process.argv[2] ?? 100);
const perimeter = Number(process.argv[3] ?? 100000000);
const original = readFileSync(new URL('../demos/euler/730_shiftedtriples.ra', import.meta.url), 'utf8');
const budget = Number(process.argv[4] ?? original.match(/arg Budget integer = (\d+)/)[1]);
assert([shifts, perimeter, budget].every(Number.isSafeInteger) && shifts >= 0 && perimeter >= 0 && budget > 0);
let source = original
    .replace('arg Shifts integer = 100', `Shifts = ${shifts}`)
    .replace('arg Perimeter integer = 10 ** 8', `Perimeter = ${perimeter}`)
    .replace(/arg Budget integer = \d+/, `Budget = ${budget}`);
for (const [before, label] of [['All = 0', 'roots'], ['Answer = (All + Diag) // 2', 'walk']]) {
    source = source.replace(before, `"stage:${label}" print\n${before}`);
}
if (process.env.TRACE_ROOTS) {
    for (const before of ['Exact =', 'Coprime =', 'FirstX =', 'FirstY =', 'Height =', 'SecondY =', 'ThirdX =',
        'Tall =', 'Root = Exact', 'Sums =', 'Zero =', 'Pool1 =', 'Pool2 =', 'Pool3 =']) {
        source = source.replace(before, `"stage:${before.split(' ')[0]}" print\n${before}`);
    }
}
if (process.env.TRACE_WALK) source = source.replace('  Size = Pool1 len', '  Size = Pool1 len\n  Size print');
if (process.env.ROOTS_ONLY) source = source.slice(0, source.indexOf('All = 0')) + 'Answer = 0';
const phases = [], code = [], diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
let last = performance.now(), batches = 0, peakPool = 0, traceRss = 0;
const runtime = new Interpreter(value => {
    const label = String(value).replaceAll('"', '');
    if (!label.startsWith('stage:')) {
        if (process.env.TRACE_WALK && /^\d+$/.test(label)) {
            batches++; peakPool = Math.max(peakPool, Number(label));
            const maxRssMiB = process.resourceUsage().maxRSS / 1024;
            if (batches % 100 === 0 || maxRssMiB > traceRss + 256) {
                traceRss = maxRssMiB;
                console.log(JSON.stringify({ batch: batches, pool: Number(label), peakPool, maxRssMiB, memory: process.memoryUsage() }));
            }
        }
        return;
    }
    const now = performance.now(), memory = process.memoryUsage();
    const phase = { stage: label.slice(6), ms: now - last, rssMiB: memory.rss / 2 ** 20,
        heapMiB: memory.heapUsed / 2 ** 20, buffersMiB: memory.arrayBuffers / 2 ** 20, maxRssMiB: process.resourceUsage().maxRSS / 1024 };
    phases.push(phase); console.log(JSON.stringify(phase)); last = now;
}, { compilation: process.argv[5] !== 'reference', ...(process.env.SAVE_CODE && {
    onIntegerLoopCompiled: value => code.push(value), onTensorKernelCompiled: value => code.push(value) }) });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(); last = start;
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (!process.env.ROOTS_ONLY && shifts === 100 && perimeter === 100000000) assert.equal(answer, '1315965924');
    console.log(JSON.stringify({ shifts, perimeter, budget, answer, nodes: String(runtime.variables.get('All')),
        ms: performance.now() - start, maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, phases, ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
    if (process.env.SAVE_CODE) writeFileSync(process.env.SAVE_CODE, code.join('\n/* region */\n'));
} finally { session.disconnect(); runtime.dispose(); }
