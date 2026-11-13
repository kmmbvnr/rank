import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { pathToFileURL } from 'node:url';
const runtimeUrl = process.env.RANK482_RUNTIME
    ? process.env.RANK482_RUNTIME.startsWith('file:') ? new URL(process.env.RANK482_RUNTIME) : pathToFileURL(process.env.RANK482_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics, isRankArray, isRankTuple } = await import(runtimeUrl);
const { readArrayItem } = await import(new URL('array-storage.js', runtimeUrl));
const [mode = 'compiled', limit = '100000', file = 'demos/euler/482_incenter.ra'] = process.argv.slice(2);
let source = readFileSync(file, 'utf8');
const phases = [], startPhases = performance.now();
if (process.env.RANK482_STAGES === 'true') {
    for (const marker of ['rem Replicate each primitive Kc times.', 'rem Windows r^2/x', 'Cs = Cn scan + with 0', 'Answer print']) {
        source = source.replace(marker, `"phase:${marker}" print\n${marker}`);
    }
}
const runtime = new Interpreter(line => phases.push({ line, ms: performance.now() - startPhases, rssMiB: process.resourceUsage().maxRSS / 1024, cpu: process.cpuUsage() }), {
    compilation: mode !== 'reference', args: [`--p=${limit}`, ...process.argv.slice(5)],
});
const diagnostics = process.env.RANK482_DIAGNOSTICS === 'false' ? undefined : new RuntimeDiagnostics();
try {
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const memory = process.memoryUsage();
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const triples = runtime.variables.get('Triples'), windows = runtime.variables.get('Windows');
    const radii = triples && isRankTuple(triples) ? triples.items[0] : undefined;
    const prefix = windows && isRankTuple(windows) ? windows.items[3] : runtime.variables.get('Cs');
    const legs = String(radii && isRankArray(radii) ? radii.shape[0] : runtime.variables.get('Ne'));
    const pairs = String(prefix && isRankArray(prefix) ? readArrayItem(prefix, prefix.shape[0] - 1) : undefined);
    const expected = process.env.RANK482_EXPECTED;
    if (expected !== undefined && answer !== expected) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, limit, file, node: process.version, arch: process.arch,
        cpu, runtime: process.env.RANK482_RUNTIME ?? 'current out', args: process.argv.slice(5), sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        heapMiB: memory.heapUsed / 1048576, externalMiB: memory.external / 1048576,
        arrayBuffersMiB: memory.arrayBuffers / 1048576, answer, legs, pairs, phases, diagnostics }));
} finally { runtime.dispose(); }
