import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK429_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', n = '100000000', file = 'demos/euler/429_unitary.ra'] = process.argv.slice(2);
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${n}`] });
const diagnostics = new RuntimeDiagnostics(), started = performance.now();
try {
 diagnostics.run(() => runtime.execute(readFileSync(file, 'utf8')));
 console.log(JSON.stringify({ mode, n, file, ms:performance.now()-started, rssMiB:process.resourceUsage().maxRSS/1024, answer:String(runtime.variables.get('Answer')), diagnostics }));
} catch(error) { console.error(error.format?.() ?? String(error));process.exitCode=1; }
finally { runtime.dispose(); }
