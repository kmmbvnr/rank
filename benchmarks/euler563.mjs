import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK563_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '60000000', file = 'demos/euler/563_robotwelders.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact', arrayFunctionCompilation: process.env.RANK563_ARRAY_FUNCTIONS !== '0', args: [`--l=${n}`, `--k=${process.env.RANK563_K ?? 100}`] });
const diagnostics = process.env.RANK563_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK563_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const k = runtime.variables.get('K'), finished = runtime.variables.get('Fd') ?? runtime.variables.get('Found');
    if (typeof k === 'bigint' && finished !== (k > 1n ? k - 1n : 0n)) throw Error('Incomplete minimum table');
    if (process.env.RANK563_EXPECTED && answer !== process.env.RANK563_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, limit: String(runtime.variables.get('L')), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        finished: String(runtime.variables.get('Fd') ?? runtime.variables.get('Found')), k: String(runtime.variables.get('K')),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK563_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK563_PROFILE, JSON.stringify(profile)); }
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { profiler.disconnect(); runtime.dispose(); }
