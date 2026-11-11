import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { Interpreter } = await import(new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '5000000', file = 'demos/euler/585_nestedsquareroots.ra'] = process.argv.slice(2);
const expected = {
    5000: ['11134074', '6239252', '9834189', '44545'],
    50000: ['1333490943', '624864969', '1418376606', '1124658'],
    5000000: ['17714439395932', '6249980999760', '22929380558578', '463766234'],
}[n];
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage();
    runtime.execute(source);
    const values = ['Answer', 'C1', 'C2', 'C3'].map(name => String(runtime.variables.get(name)));
    if (expected && values.some((value, index) => value !== expected[index])) throw Error(`Wrong counts: ${values.join(', ')}`);
    console.log(JSON.stringify({ mode, n, file, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, values }));
} finally { runtime.dispose(); }
