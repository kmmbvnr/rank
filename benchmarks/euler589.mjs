import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(process.env.RANK589_RUNTIME ? pathToFileURL(process.env.RANK589_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', k = '100', d = '5', file = 'demos/euler/589_poohsticks.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--k=${k}`, `--d=${d}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage();
    runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    const expected = { '100/5': '131776959.25', '20/5': '402964.24', '5/5': '7722.82' }[`${k}/${d}`];
    if (expected && answer !== expected) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, k, d, file, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms: performance.now() - start,
        cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { runtime.dispose(); }
