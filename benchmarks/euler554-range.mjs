import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK554_RUNTIME;
const { Interpreter } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', text = '100000'] = process.argv.slice(2);
const count = BigInt(text), modulus = 100000007n;
let expected = 1n;
for (let i = 1n; i <= count; i++) expected = expected * i % modulus;
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact' });
try {
    runtime.execute(`use sequences
Mod = ${modulus}
fun Acc combine Value
 return Acc * Value mod Mod
end
Span' = 1 to ${count}`);
    const start = performance.now(), cpu = process.cpuUsage();
    const answer = runtime.execute('Span reduce combine with 1');
    const ms = performance.now() - start;
    if (answer !== expected) throw Error(`Wrong result: ${answer}`);
    console.log(JSON.stringify({ mode, count: String(count), answer: String(answer), ms,
        cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
