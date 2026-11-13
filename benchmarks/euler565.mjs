import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK565_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '100000000000', file = 'demos/euler/565_divisibilityofsigma.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact', arrayFunctionCompilation: process.env.RANK565_ARRAY_FUNCTIONS !== '0', args: [`--n=${n}`] });
const diagnostics = process.env.RANK565_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK565_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    if (process.env.RANK565_EXPECTED && answer !== process.env.RANK565_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, limit: String(runtime.variables.get('N')), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        unrounded: String(runtime.variables.get('Total') ?? runtime.variables.get('Raw')),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK565_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK565_PROFILE, JSON.stringify(profile)); }
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { profiler.disconnect(); runtime.dispose(); }
