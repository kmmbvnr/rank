import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK450_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', limit = '1000000', file = 'demos/euler/450_hypocycloid.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', args: [`--n=${limit}`, ...process.argv.slice(5)],
});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const memory = process.memoryUsage();
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const checkpoints = { 0: '0', 3: '10', 10: '524', 100: '580442', 1000: '583108600', 1000000: '583333163984220940' };
    if (checkpoints[limit] !== undefined && answer !== checkpoints[limit]) throw new Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, limit, file, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        heapMiB: memory.heapUsed / 1048576, externalMiB: memory.external / 1048576,
        arrayBuffersMiB: memory.arrayBuffers / 1048576, answer, diagnostics }));
} finally { runtime.dispose(); }
