import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK562_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '10000000', file = 'demos/euler/562_maximalperimeter.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact', arrayFunctionCompilation: process.env.RANK562_ARRAY_FUNCTIONS !== '0', args: [`--r=${n}`, `--dm=${process.env.RANK562_DM ?? 2000000}`] });
const diagnostics = process.env.RANK562_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK562_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (process.env.RANK562_EXPECTED && answer !== process.env.RANK562_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, limit: String(runtime.variables.get('R')), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        norm: String(runtime.variables.get('Norm') ?? runtime.variables.get('Bl')), q: String(runtime.variables.get('Q') ?? runtime.variables.get('Bq')),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK562_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK562_PROFILE, JSON.stringify(profile)); }
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { profiler.disconnect(); runtime.dispose(); }
