import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK466_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', rows = '64', limit = '10000000000000000', file = 'demos/euler/466_distinctproducts.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', args: [`--m=${rows}`, `--n=${limit}`, ...process.argv.slice(6)],
});
const diagnostics = process.env.RANK466_DIAGNOSTICS === 'false' ? undefined : new RuntimeDiagnostics();
try {
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const memory = process.memoryUsage();
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const checkpoints = { '64:10000000000000000': '258381958195474745', '3:4': '8', '64:64': '1263', '12:345': '1998', '32:1000000000000000': '13826382602124302' };
    const expected = checkpoints[`${rows}:${limit}`];
    if (expected !== undefined && answer !== expected) throw new Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, rows, limit, file, node: process.version, arch: process.arch,
        cpu, args: process.argv.slice(6), sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        heapMiB: memory.heapUsed / 1048576, externalMiB: memory.external / 1048576,
        arrayBuffersMiB: memory.arrayBuffers / 1048576, answer, diagnostics }));
} finally { runtime.dispose(); }
