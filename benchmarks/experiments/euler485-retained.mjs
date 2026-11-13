import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK485_RUNTIME;
const { Interpreter } = await import(chosen ? pathToFileURL(chosen) : new URL('../../packages/interpreter/out/index.js', import.meta.url));
if (!global.gc) throw Error('Run with --expose-gc');
const runtime = new Interpreter(() => {});
try {
    runtime.execute(readFileSync('demos/euler/485_maxdivisors.ra', 'utf8'));
    if ((runtime.variables.get('Answer') ?? runtime.lastResult) !== 51281274340n) throw Error('Wrong answer');
    for (let i = 0; i < 3; i++) { global.gc(); await new Promise(resolve => setImmediate(resolve)); }
    console.log(JSON.stringify({ node: process.version, arch: process.arch, answer: String((runtime.variables.get('Answer') ?? runtime.lastResult)),
        heapMiB: process.memoryUsage().heapUsed / 1048576, arrayBuffersMiB: process.memoryUsage().arrayBuffers / 1048576,
        rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
