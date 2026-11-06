import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const length = Number(process.argv[2] ?? 100000000);
const chunk = Number(process.argv[3] ?? 4194304);
const source = readFileSync(process.env.RANK_SOURCE ?? `${root}/demos/euler/739_summationofsummations.ra`, 'utf8')
    .replace('arg Length integer = 10 ** 8', `Length = ${length}`)
    .replace('arg Chunk integer = 4194304', `Chunk = ${chunk}`);
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
const runtime = new Interpreter(value => { if (process.env.TRACE) console.error(String(value)); },
    { compilation: process.argv[4] !== 'reference' });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    const expected = new Map([[8, '2663'], [20, '742296999'], [100000000, '711399016']]);
    if (expected.has(length)) assert.equal(answer, expected.get(length));
    if (process.env.EXPECTED) assert.equal(answer, process.env.EXPECTED);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ length, chunk, answer,
        ms: performance.now() - start, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch,
        ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
} finally { session.disconnect(); runtime.dispose(); }
