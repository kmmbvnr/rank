import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK452_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', limit = '1000000000', file = 'demos/euler/452_longproducts.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const extra = process.argv.slice(5);
const length = extra.findLast(value => value.startsWith('--n='))?.slice(4) ?? limit;
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', args: [`--m=${limit}`, `--n=${length}`, ...extra.filter(value => !value.startsWith('--n='))],
});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const memory = process.memoryUsage();
    const answer = String(runtime.variables.get('Answer'));
    const checkpoints = { 10: '571', 1000000: '252903833', 1000000000: '345558983' };
    if (length === limit && checkpoints[limit] !== undefined && answer !== checkpoints[limit]) throw new Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, limit, length, file, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        heapMiB: memory.heapUsed / 1048576, externalMiB: memory.external / 1048576,
        arrayBuffersMiB: memory.arrayBuffers / 1048576, answer, diagnostics }));
} finally { runtime.dispose(); }
