import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK465_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', limit = '96889010407', file = 'demos/euler/465_polarpolygons.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', args: [`--n=${limit}`, ...process.argv.slice(5)],
});
const diagnostics = process.env.RANK465_DIAGNOSTICS === 'false' ? undefined : new RuntimeDiagnostics();
try {
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const memory = process.memoryUsage();
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const checkpoints = { 96889010407: '585965659', 1: '131', 2: '1648531', 3: '461288482', 343: '937293740' };
    if (checkpoints[limit] !== undefined && answer !== checkpoints[limit]) throw new Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, limit, file, node: process.version, arch: process.arch,
        cpu, prefixLimit: String(runtime.variables.get('Bound') ?? runtime.variables.get('L')), args: process.argv.slice(5), sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        heapMiB: memory.heapUsed / 1048576, externalMiB: memory.external / 1048576,
        arrayBuffersMiB: memory.arrayBuffers / 1048576, answer, diagnostics }));
} finally { runtime.dispose(); }
