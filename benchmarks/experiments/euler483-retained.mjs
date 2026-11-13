import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const chosen = process.env.RANK483_RUNTIME;
const url = chosen ? pathToFileURL(chosen) : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics } = await import(url);
if (!global.gc) throw Error('Run with --expose-gc');
const mode = process.argv[2] ?? 'compiled';
const source = readFileSync(new URL('../fixtures/euler483-original.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: ['--n=350'] });
const diagnostics = new RuntimeDiagnostics();
try {
    diagnostics.run(() => runtime.execute(source));
    const before = process.memoryUsage();
    global.gc();
    const after = process.memoryUsage();
    console.log(JSON.stringify({ runtime: url.href, mode, before, after,
        answer: String((runtime.variables.get('Answer') ?? runtime.lastResult)), rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
