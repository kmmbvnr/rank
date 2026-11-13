import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadavg, cpus } from 'node:os';
const { Interpreter } = await import(process.env.RANK593_RUNTIME ? pathToFileURL(process.env.RANK593_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '10000000', k = '100000', file = 'demos/euler/593_fleetingmedians.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`, `--k=${k}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage(), load = loadavg();
    runtime.execute(source);
    const answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    const expected = { '10/10': '2021.5', '100/10': '463628.5', '100000/10000': '675348207.5', '10000000/100000': '96632320042.0' }[`${n}/${k}`];
    if (expected && answer !== expected) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, k, file, node: process.version, arch: process.arch, processor: cpus()[0]?.model, load,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms: performance.now() - start,
        cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { runtime.dispose(); }
