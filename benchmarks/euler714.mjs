import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const count = Number(process.argv[2] ?? 50000), longest = Number(process.argv[3] ?? 18);
const block = Number(process.argv[4] ?? 16777216);
let source = readFileSync(process.env.RANK_SOURCE ?? `${root}/demos/euler/714_duodigits.ra`, 'utf8')
    .replace('arg Count integer = 50000', `Count = ${count}`)
    .replace('arg Longest integer = 18', `Longest = ${longest}`)
    .replace('arg Block integer = 16777216', `Block = ${block}`);
if (process.env.TRACE) source = source.replace('    Size += 1', '    Size += 1\n    Size print');
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
const runtime = new Interpreter(value => { if (process.env.TRACE) console.error(String(value)); },
    { compilation: process.argv[5] !== 'reference' });
const session = new Session();
try {
    if (process.env.PROFILE) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const expected = new Map([[110, '1.104700000000e4'], [150, '5.331200000000e4'],
        [500, '2.957098800000e7'], [50000, '2.452767775565e20']]);
    if (expected.has(count)) assert.equal(answer, expected.get(count));
    if (process.env.EXPECTED) assert.equal(answer, process.env.EXPECTED);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ count, longest, block, answer, total: String(runtime.variables.get('Together')),
        pending: String(runtime.variables.get('Left')),
        ms: performance.now() - start, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch,
        ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
} finally { session.disconnect(); runtime.dispose(); }
