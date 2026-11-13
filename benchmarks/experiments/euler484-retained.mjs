import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK484_RUNTIME;
const url = chosen ? chosen.startsWith('file:') ? new URL(chosen) : pathToFileURL(chosen)
    : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics } = await import(url);
if (!global.gc) throw Error('Run with --expose-gc');
const source = readFileSync(new URL('../../demos/euler/483_repeatedpermutation.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { args: ['--n=350'] });
const diagnostics = new RuntimeDiagnostics();
try {
    diagnostics.run(() => runtime.execute(source));
    const before = process.memoryUsage();
    global.gc();
    const after = process.memoryUsage();
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    if (answer !== '4.993401567e22') throw Error('Wrong answer');
    console.log(JSON.stringify({ runtime: url.href, node: process.version, arch: process.arch,
        before, after, answer, rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
