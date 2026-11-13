import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK540_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '3141592653589793', file = 'demos/euler/540_primitivetriples.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`, ...(process.env.RANK540_TABLE ? [`--table=${process.env.RANK540_TABLE}`] : []), ...(process.env.RANK540_BATCH ? [`--batch=${process.env.RANK540_BATCH}`] : [])] });
const diagnostics = process.env.RANK540_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK540_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    if (process.env.RANK540_EXPECTED && answer !== process.env.RANK540_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, table: runtime.variables.get('Table')?.toString(), batch: runtime.variables.get('Batch')?.toString(), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK540_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK540_PROFILE, JSON.stringify(profile)); }
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { profiler.disconnect(); runtime.dispose(); }
