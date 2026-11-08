import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
const { Interpreter, RuntimeDiagnostics } = await import(
    process.env.RANK_INTERPRETER ?? '../packages/interpreter/out/index.js');
const size = Number(process.argv[2] ?? 100000);
let source = readFileSync(process.env.RANK_SOURCE ?? new URL('../demos/euler/790_clockgrid.ra', import.meta.url), 'utf8')
    .replace('arg Steps integer = 100000', `Steps = ${size}`);
if (process.env.CHUNK) source = source.replace('arg Chunk integer = 512', `Chunk = ${Number(process.env.CHUNK)}`);
const runtime = new Interpreter(value => { if (process.env.TRACE) console.error(Math.round(performance.now()), String(value)); },
    { compilation: process.env.COMPILED !== '0' });
const diagnostics = new RuntimeDiagnostics();
const profiler = new Session();
try {
    if (process.env.PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const answer = String(runtime.variables.get('Answer'));
    if (process.env.EXPECTED) assert.equal(answer, process.env.EXPECTED);
    console.log(JSON.stringify({ size, answer, ms: performance.now() - start,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch, diagnostics }));
    if (process.env.PROFILE) { const {profile} = await profiler.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
} finally { profiler.disconnect(); runtime.dispose(); }
