import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
const chosen = process.env.RANK566_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '53', file = 'demos/euler/566_cakeicing.ra'] = process.argv.slice(2);
const triple = process.env.RANK566_TRIPLE?.split(',').map(Number);
if (triple && (triple.length !== 3 || !triple.every(Number.isSafeInteger)
    || triple[0] < 9 || triple[0] >= triple[1] || triple[1] >= triple[2])) throw Error('expected three increasing integers from 9');
const bound = triple ? '8' : n;
const source = readFileSync(file, 'utf8') + (triple ? `\nTriple = array ${triple.join(' ')}\nAnswer = Triple icing\n` : '');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact', arrayFunctionCompilation: process.env.RANK566_ARRAY_FUNCTIONS !== '0', args: [`--n=${bound}`] });
const diagnostics = process.env.RANK566_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const profiler = new Session();
try {
    if (process.env.RANK566_PROFILE) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start'); }
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (process.env.RANK566_EXPECTED && answer !== process.env.RANK566_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n: bound, triple, limit: String(runtime.variables.get('N')), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        unrounded: String(runtime.variables.get('Total') ?? runtime.variables.get('Raw')),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, diagnosticMode: !!diagnostics, diagnostics }));
    if (process.env.RANK566_PROFILE) { const { profile } = await profiler.post('Profiler.stop'); writeFileSync(process.env.RANK566_PROFILE, JSON.stringify(profile)); }
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { profiler.disconnect(); runtime.dispose(); }
