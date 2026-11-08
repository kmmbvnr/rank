import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const chosen = process.env.RANK487_RUNTIME;
const url = chosen ? chosen.startsWith('file:') ? new URL(chosen) : pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics } = await import(url);
const [mode = 'compiled', size = '1000000000000', path = 'demos/euler/487_sumsofpowersums.ra'] = process.argv.slice(2);
const source = readFileSync(path, 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${size}`, ...process.argv.slice(5)] });
const diagnostics = new RuntimeDiagnostics(), start = performance.now(), cpu = process.cpuUsage();
try {
    diagnostics.run(() => runtime.execute(source));
    if (process.env.RANK487_EXPECTED && String(runtime.variables.get('Answer')) !== process.env.RANK487_EXPECTED) {
        throw Error('Wrong answer');
    }
    console.log(JSON.stringify({
        mode, size, args: process.argv.slice(5), node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024,
        answer: String(runtime.variables.get('Answer')),
        diagnostics,
    }, null, 2));
} finally { runtime.dispose(); }
