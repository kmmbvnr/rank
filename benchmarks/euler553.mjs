import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK553_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '10000', file = 'demos/euler/553_powersetsofpowersets.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const fixture = n === 'fixture';
const moduleSource = fixture ? readFileSync(process.env.RANK553_MODULE ?? 'demos/euler/553_powersetsofpowersets.ra', 'utf8') : undefined;
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact', args: fixture ? [] : [`--n=${n}`, `--k=${process.env.RANK553_K ?? 10}`],
    sourceId: resolve(file), testing: fixture,
    loadModule: (specifier, fromId) => {
        const id = resolve(dirname(fromId ?? resolve(file)), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
        return { id, source: id.endsWith('/553_powersetsofpowersets.ra') && moduleSource !== undefined ? moduleSource : readFileSync(id, 'utf8') };
    } });
const diagnostics = process.env.RANK553_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK553_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    if (fixture && (runtime.testResults.length !== 1 || runtime.testResults.some(test => !test.passed))) throw Error(JSON.stringify(runtime.testResults));
    const answer = fixture ? 'passed' : String(runtime.variables.get('Answer'));
    if (process.env.RANK553_EXPECTED && answer !== process.env.RANK553_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, limit: String(runtime.variables.get('N')), k: String(runtime.variables.get('K')), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        moduleSha256: moduleSource === undefined ? undefined : createHash('sha256').update(moduleSource).digest('hex'),
        tests: fixture ? runtime.testResults.map(({ name, passed }) => ({ name, passed })) : undefined,
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK553_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK553_PROFILE, JSON.stringify(profile)); }
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { profiler.disconnect(); runtime.dispose(); }
