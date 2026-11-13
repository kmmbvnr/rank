import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK424_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', count = '1', file = 'demos/euler/424_kakuro.ra'] = process.argv.slice(2);
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--count=${count}`], io: { read: path => readFileSync(path) } });
const diagnostics = new RuntimeDiagnostics(), start = performance.now();
try {
    diagnostics.run(() => runtime.execute(readFileSync(file, 'utf8')));
    console.log(JSON.stringify({ mode, count, file, ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024, answer: String((runtime.variables.get('Answer') ?? runtime.lastResult)), diagnostics }));
} catch (error) { console.error(error.format?.() ?? String(error)); process.exitCode = 1; } finally { runtime.dispose(); }
