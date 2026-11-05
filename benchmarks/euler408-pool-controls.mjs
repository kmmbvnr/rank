import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
const [file, ...args] = process.argv.slice(2);
const runtime = new Interpreter(() => {}, { args }), diagnostics = new RuntimeDiagnostics(), start = performance.now();
try {
    diagnostics.run(() => runtime.execute(readFileSync(file, 'utf8')));
    console.log(JSON.stringify({ file, args, ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024,
        answer: String(runtime.variables.get('Answer')), diagnostics }));
} finally { runtime.dispose(); }
