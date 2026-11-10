import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const entry = process.env.RANK584_RUNTIME ? pathToFileURL(process.env.RANK584_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics } = await import(entry);
const [mode = 'compiled', n = '365', k = '4', d = '7', file = 'demos/euler/584_birthdayrevisited.ra'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8'), diagnostics = process.env.RANK584_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const r = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`, `--k=${k}`, `--d=${d}`] });
try {
    const start = performance.now(), cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => r.execute(source)); else r.execute(source);
    const answer = String(r.variables.get('Answer'));
    if (process.env.RANK584_EXPECTED && answer !== process.env.RANK584_EXPECTED) throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, n, k, d, file, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms: performance.now() - start,
        cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024, answer,
        diagnosticMode: !!diagnostics, diagnostics }));
} catch (error) { console.error(error?.format?.() ?? error?.stack ?? String(error)); process.exitCode = 1; }
finally { r.dispose(); }
