import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
if (!global.gc) throw Error('Run with --expose-gc');
const [file = 'demos/euler/495_distinctproduct.ra', chosen] = process.argv.slice(2);
const { Interpreter } = await import(chosen ? pathToFileURL(chosen) : new URL('../../packages/interpreter/out/index.js', import.meta.url));
const source = readFileSync(file, 'utf8'), runtime = new Interpreter(() => {}), runs = [];
try {
    for (let turn = 0; turn < 3; turn++) {
        runtime.execute(turn && source.includes('fun N solve K') ? 'Answer = N solve K' : source);
        if ((runtime.variables.get('Answer') ?? runtime.lastResult) !== 789107601n) throw Error('Wrong answer');
        for (let i = 0; i < 3; i++) { global.gc(); await new Promise(resolve => setImmediate(resolve)); }
        const memory = process.memoryUsage();
        runs.push({ heapMiB: memory.heapUsed / 2 ** 20, arrayBuffersMiB: memory.arrayBuffers / 2 ** 20 });
    }
    console.log(JSON.stringify({ file, sourceSha256: createHash('sha256').update(source).digest('hex'),
        node: process.version, arch: process.arch, runs, rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
