import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadavg, cpus } from 'node:os';
const { Interpreter } = await import(process.env.RANK590_RUNTIME ? pathToFileURL(process.env.RANK590_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '50000', file = 'demos/euler/590_setswithlcm.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage(), load = loadavg();
    runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const expected = { 4: '44', 6: '3748', 10: '946139968', 16: '265773312', 50000: '834171904' }[n];
    if (expected && answer !== expected) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, file, node: process.version, arch: process.arch, processor: cpus()[0]?.model, load,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms: performance.now() - start,
        cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { runtime.dispose(); }
