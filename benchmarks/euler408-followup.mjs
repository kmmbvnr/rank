import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
const [file = 'demos/euler/408_admissiblepaths.ra', limit = '10000000', mode = 'compiled'] = process.argv.slice(2);
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics(), start = performance.now();
try {
    diagnostics.run(() => runtime.execute(readFileSync(file, 'utf8')));
    console.log(JSON.stringify({ file, limit, mode, ms: performance.now() - start,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer: String((runtime.variables.get('Answer') ?? runtime.lastResult)),
        points: String(runtime.variables.get('Count') ?? runtime.variables.get('M')), diagnostics }));
} finally { runtime.dispose(); }
