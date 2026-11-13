import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { Interpreter } = await import(new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '1000000000000000', r = '40', file = 'demos/euler/586_binaryquadraticform.ra'] = process.argv.slice(2);
const expected = {
    '100000/4': '237',
    '100000000/6': '59517',
    '1000000000000000/40': '82490213',
}[`${n}/${r}`];
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`, `--r=${r}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage();
    runtime.execute(source);
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    if (expected && answer !== expected) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, r, file, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} finally { runtime.dispose(); }
