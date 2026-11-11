import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadavg, cpus } from 'node:os';
const { Interpreter } = await import(process.env.RANK596_RUNTIME ? pathToFileURL(process.env.RANK596_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', r = '100000000', file = 'demos/euler/596_hyperballpoints.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--r=${r}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage(), load = loadavg();
    runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    const expected = { 0: '1', 1: '9', 2: '89', 5: '3121', 100: '493490641', 10000: '733649750', 100000000: '734582049' }[r];
    if (expected && answer !== expected) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, r, file, node: process.version, arch: process.arch, processor: cpus()[0]?.model, load,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms: performance.now() - start,
        cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { runtime.dispose(); }
