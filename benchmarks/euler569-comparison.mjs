import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK569_RUNTIME;
const { Interpreter } = await import(chosen ? pathToFileURL(chosen) : new URL('../packages/interpreter/out/index.js', import.meta.url));
const count = Number(process.argv[2] ?? '10000000');
if (!Number.isSafeInteger(count) || count < 0) throw Error('expected a nonnegative safe count');
const source = `Total = 0
for I in 1 to ${count}
 if I * 3 equal 3 * I
  Total += 1
 end
end`;
const runtime = new Interpreter(() => {});
try {
    const start = performance.now(), cpu = process.cpuUsage();
    runtime.execute(source);
    const answer = String(runtime.variables.get('Total'));
    if (answer !== String(count)) throw Error('wrong total');
    console.log(JSON.stringify({ control: 'small-product-ties', count, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms: performance.now() - start,
        cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} finally { runtime.dispose(); }
