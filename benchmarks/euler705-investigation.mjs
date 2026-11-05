import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..');
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));

const size = Number(process.argv[2] ?? 100000000);
const mode = process.argv[3] ?? 'compiled';
const variant = process.argv[4] ?? 'original';
assert.ok(['original', 'axes', 'bounds'].includes(variant));
let source = readFileSync(process.env.RANK_SOURCE ?? new URL('../demos/euler/705_inversioncount.ra', import.meta.url), 'utf8');
if (variant !== 'original') source = source.replace('Ex matmul (Hm transpose)', 'Ex matmul Hm axis 1 1');
if (variant === 'bounds') source = source.replace(
    '  Lo = Pr at least 10 ** (L - 1)\n  Hi = Pr less 10 ** L\n  Bk = Pr filter (Lo and Hi)',
    '  Bk = Pr from (10 ** (L - 1))\n  Bk = Bk till (10 ** L)');
source = source.replace(/arg (Nn|Limit) integer = 10 \*\* 8/, (_, name) => `${name} = ${size}`);
// Mark completed stages without splitting execution or changing variable lifetimes.
for (const [before, label] of [
    [source.includes('Primes =') ? 'Width =' : 'Dg = array', 'sieve'], [source.includes('Faces =') ? 'Faces = 1 to 9' : 'Vs = 1 to 9', 'digits'],
    ['rem Divisor table', 'pairs'], ['Answer print', 'weights'],
]) source = source.replace(before, `"stage:${label}" print\n${before}`);
const phases = [];
let last = performance.now();
const runtime = new Interpreter(value => {
    const label = String(value).replaceAll('"', '');
    if (!label.startsWith('stage:')) return;
    const now = performance.now();
    const memory = process.memoryUsage();
    const phase = { stage: label.slice(6), ms: now - last,
        rssMiB: memory.rss / 2 ** 20, heapMiB: memory.heapUsed / 2 ** 20,
        buffersMiB: memory.arrayBuffers / 2 ** 20 };
    phases.push(phase);
    console.log(JSON.stringify(phase));
    last = now;
}, { compilation: mode !== 'reference' });
const session = new Session();
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
try {
    if (process.env.PROFILE) {
        session.connect();
        await session.post('Profiler.enable');
        await session.post('Profiler.start');
    }
    const start = performance.now();
    last = start;
    if (diagnostics) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (size === 100000000) assert.equal(answer, '480440153');
    console.log(JSON.stringify({ size, mode, variant, answer, ms: performance.now() - start,
        maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, phases,
        ...(diagnostics && { diagnostics: { compiledLoops: diagnostics.compiledLoops,
            numberLoops: diagnostics.numberLoops, fallbacks: diagnostics.fallbacks } }) }));
    if (process.env.PROFILE) {
        const { profile } = await session.post('Profiler.stop');
        writeFileSync(process.env.PROFILE, JSON.stringify(profile));
    }
} finally { session.disconnect(); runtime.dispose(); }
