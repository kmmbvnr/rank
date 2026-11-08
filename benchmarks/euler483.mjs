import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const chosen = process.env.RANK483_RUNTIME;
const url = chosen ? chosen.startsWith('file:') ? new URL(chosen) : pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics } = await import(url);
const [mode = 'compiled', size = '350', path = 'demos/euler/483_repeatedpermutation.ra'] = process.argv.slice(2);
const source = readFileSync(path, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${size}`] });
const diagnostics = new RuntimeDiagnostics(), start = performance.now(), cpu = process.cpuUsage();
try {
    diagnostics.run(() => runtime.execute(source));
    if (process.env.RANK483_EXPECTED && String(runtime.variables.get('Answer')) !== process.env.RANK483_EXPECTED) {
        throw Error('Wrong answer');
    }
    console.log(JSON.stringify({
        mode, size, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024,
        answer: String(runtime.variables.get('Answer')),
        numerator: String(runtime.variables.get('Total') ?? runtime.variables.get('G')),
        diagnostics,
    }, null, 2));
} finally { runtime.dispose(); }
