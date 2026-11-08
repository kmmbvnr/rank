// A general scalar subexpression before an array reduction, separate from Euler.
import { createHash } from 'node:crypto';
const runtime = process.env.RANK478_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url).href;
const { Interpreter, RuntimeDiagnostics } = await import(runtime);
const { typedArray } = await import(new URL('array-storage.js', runtime));
const size = Number(process.argv[2] ?? 1000000), repeats = Number(process.argv[3] ?? 12);
const operation = process.argv[4] ?? '//';
if (!['//', 'mod'].includes(operation)) throw Error('Expected // or mod');
const source = `use sequences\nTotal = (Input + (Scale ${operation} Divisor)) sum`;
const r = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
r.variables.set('Input', typedArray(Int32Array.from({ length: size }, (_, i) => i % 97)));
r.variables.set('Scale', 1000000037n); r.variables.set('Divisor', 7n);
const quotient = operation === '//' ? 1000000037n / 7n : 1000000037n % 7n;
const batches = Math.floor(size / 97), tail = size % 97;
const expected = BigInt(size) * quotient + BigInt(batches * 4656 + tail * (tail - 1) / 2);
try {
    r.execute(source); r.execute(source);
    const cpuStart = process.cpuUsage(), started = performance.now();
    diagnostics.run(() => { for (let i = 0; i < repeats; i++) r.execute(source); });
    const ms = performance.now() - started;
    if (r.variables.get('Total') !== expected) throw Error('Wrong sum');
    console.log(JSON.stringify({ runtime, size, repeats, operation, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms, cpu: process.cpuUsage(cpuStart),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(expected), diagnostics }));
} finally { r.dispose(); }
