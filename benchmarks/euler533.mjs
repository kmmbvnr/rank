import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK533_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const { readArrayItem } = await import(chosen ? new URL('./array-storage.js', pathToFileURL(chosen))
    : new URL('../packages/interpreter/out/array-storage.js', import.meta.url));
const [mode = 'compiled', n = '20000000', file = 'demos/euler/533_carmichael.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`] });
const diagnostics = process.env.RANK533_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK533_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    const winner = runtime.variables.get('Tb');
    const score = winner === undefined ? undefined : String(readArrayItem(runtime.variables.get('Lg'), Number(winner)));
    if (process.env.RANK533_EXPECTED && answer !== process.env.RANK533_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, winner: winner === undefined ? undefined : String(winner), score, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK533_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK533_PROFILE, JSON.stringify(profile)); }
} finally { profiler.disconnect(); runtime.dispose(); }
