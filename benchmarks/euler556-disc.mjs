import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK556_RUNTIME;
const { Interpreter } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [text = '10000000000'] = process.argv.slice(2), norm = Number(text);
if (!Number.isSafeInteger(norm) || norm < 1) throw Error('expected a positive safe integer');
let height = Math.floor(Math.sqrt(norm)), expected = 0n;
for (let x = 1; x * x <= norm; x++) {
    while (x * x + height * height > norm) height--;
    expected += BigInt(height + 1);
}
const runtime = new Interpreter(() => {}, { args: ['--n=0'] });
try {
    runtime.execute(readFileSync('demos/euler/556_squarefreegaussian.ra', 'utf8'));
    const fn = runtime.variables.get('disc'), start = performance.now(), cpu = process.cpuUsage();
    const answer = fn.call([BigInt(norm)]), ms = performance.now() - start;
    if (answer !== expected) throw Error(`Wrong result: ${answer} vs ${expected}`);
    console.log(JSON.stringify({ norm: text, ms, answer: String(answer), cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
