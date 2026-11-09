import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK531_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', lo = '1000000', hi = '1005000', file = 'demos/euler/531_chineseleftovers.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--lo=${lo}`, `--hi=${hi}`] });
const diagnostics = process.env.RANK531_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK531_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (process.env.RANK531_EXPECTED && answer !== process.env.RANK531_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, lo, hi, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK531_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK531_PROFILE, JSON.stringify(profile)); }
} finally { profiler.disconnect(); runtime.dispose(); }
