import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const limit = Number(process.argv[2] ?? 1e10);
const count = Number(process.argv[3] ?? limit);
const source = readFileSync(process.env.RANK_SOURCE ?? `${root}/demos/euler/738_orderedfactorisations.ra`, 'utf8')
    .replace('arg Limit integer = 10 ** 10', `Limit = ${limit}`)
    .replace('arg Kmax integer = 10 ** 10', `Kmax = ${count}`);
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
const code = [];
const runtime = new Interpreter(() => {}, { compilation: process.argv[4] !== 'reference',
    ...(process.env.SAVE_CODE && { onIntegerLoopCompiled: text => code.push(text), onTensorKernelCompiled: text => code.push(text) }) });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    if (limit === 1e10 && count === 1e10) assert.equal(answer, '143091030');
    if (process.env.EXPECTED) assert.equal(answer, process.env.EXPECTED);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ limit, count, answer, ms: performance.now() - start,
        cpuMs: (used.user + used.system) / 1000, maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
    if (process.env.SAVE_CODE) writeFileSync(process.env.SAVE_CODE, code.join('\n/* region */\n'));
} finally { session.disconnect(); runtime.dispose(); }
