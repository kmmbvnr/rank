import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK551_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '1000000000000000', file = 'demos/euler/551_sumofdigitssequence.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const fixture = n === 'fixture';
const moduleSource = fixture ? readFileSync(process.env.RANK551_MODULE ?? 'demos/euler/551_sumofdigitssequence.ra', 'utf8') : undefined;
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: fixture ? [] : [`--n=${n}`],
    sourceId: resolve(file), testing: fixture,
    loadModule: (specifier, fromId) => {
        const id = resolve(dirname(fromId ?? resolve(file)), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
        return { id, source: id.endsWith('/551_sumofdigitssequence.ra') && moduleSource !== undefined ? moduleSource : readFileSync(id, 'utf8') };
    } });
const diagnostics = process.env.RANK551_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK551_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    if (fixture && (runtime.testResults.length !== 1 || runtime.testResults.some(test => !test.passed))) throw Error(JSON.stringify(runtime.testResults));
    const answer = fixture ? 'passed' : String((runtime.variables.get('Answer') ?? runtime.lastResult));
    if (process.env.RANK551_EXPECTED && answer !== process.env.RANK551_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, limit: String(runtime.variables.get('N')), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        moduleSha256: moduleSource === undefined ? undefined : createHash('sha256').update(moduleSource).digest('hex'),
        tests: fixture ? runtime.testResults.map(({ name, passed }) => ({ name, passed })) : undefined,
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK551_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK551_PROFILE, JSON.stringify(profile)); }
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { profiler.disconnect(); runtime.dispose(); }
