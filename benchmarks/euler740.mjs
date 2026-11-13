import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const people = Number(process.argv[2] ?? 100);
const source = readFileSync(process.env.RANK_SOURCE ?? `${root}/demos/euler/740_secretsanta.ra`, 'utf8')
    .replace('arg People integer = 100', `People = ${people}`);
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
const runtime = new Interpreter(value => { if (process.env.TRACE) console.error(String(value)); },
    { compilation: process.argv[3] !== 'reference' });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const expected = new Map([[3, '0.3611111111'], [5, '0.2476095994'], [100, '0.0189581208']]);
    if (expected.has(people)) assert.equal(answer, expected.get(people));
    if (process.env.EXPECTED) assert.equal(answer, process.env.EXPECTED);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ people, answer,
        ms: performance.now() - start, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch,
        ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
} finally { session.disconnect(); runtime.dispose(); }
