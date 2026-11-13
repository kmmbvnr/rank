import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK454_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', limit = '1000000000000', file = 'demos/euler/454_diophantinereciprocals.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', args: [`--l=${limit}`, ...process.argv.slice(5)],
});
const diagnostics = process.env.RANK454_DIAGNOSTICS === 'false' ? undefined : new RuntimeDiagnostics();
try {
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const memory = process.memoryUsage();
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const checkpoints = { 15: '4', 1000: '1069', 100000000: '349446716', 1000000000000: '5435004633092' };
    if (checkpoints[limit] !== undefined && answer !== checkpoints[limit]) throw new Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, limit, file, node: process.version, arch: process.arch,
        cpu, sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        heapMiB: memory.heapUsed / 1048576, externalMiB: memory.external / 1048576,
        arrayBuffersMiB: memory.arrayBuffers / 1048576, answer, diagnostics }));
} finally { runtime.dispose(); }
