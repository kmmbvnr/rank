import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { Interpreter } = await import(new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', k = '8916100448256', file = 'demos/euler/524_firstsort2.ra'] = process.argv.slice(2);
const expected = { '0': '1', '5': '8', '6': '5', '79': '7143', '1001': '3634441',
    '8916100448256': '2432925835413407847' }[k];
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--k=${k}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage();
    runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (expected && answer !== expected) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, k, file, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} finally { runtime.dispose(); }
