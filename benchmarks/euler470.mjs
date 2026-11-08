import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK470_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', limit = '16', file = 'demos/euler/470_superramvok.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', args: [`--n=${limit}`, ...process.argv.slice(5)],
});
const diagnostics = process.env.RANK470_DIAGNOSTICS === 'false' ? undefined : new RuntimeDiagnostics();
try {
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const memory = process.memoryUsage();
    const answer = String(runtime.variables.get('Answer'));
    const checkpoints = { '10':'45968', '20':'147668794' };
    const expected = checkpoints[limit];
    const costs = runtime.variables.get('Sd');
    const costOne = costs?.kind === 'array' ? Number(costs.items[1]) : undefined;
    if (limit === '6' && Math.abs(costOne - 208.3) > 1e-9) throw Error('Wrong S(6,1)');
    if (expected !== undefined && answer !== expected) throw new Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, limit, file, node: process.version, arch: process.arch,
        cpu, runtime: process.env.RANK470_RUNTIME ?? 'current out', args: process.argv.slice(5), sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        heapMiB: memory.heapUsed / 1048576, externalMiB: memory.external / 1048576,
        arrayBuffersMiB: memory.arrayBuffers / 1048576, answer, costOne, diagnostics }));
} finally { runtime.dispose(); }
