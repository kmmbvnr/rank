import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
const [file = 'demos/euler/410_circleandtangent.ra', r = '100000000', x = '1000000000',
    mode = 'compiled', block] = process.argv.slice(2);
let entries = 0;
const count = () => entries++;
const observed = mode === 'observed';
const diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', testing: observed,
    args: [`--r=${r}`, `--x=${x}`, ...(block ? [`--block=${block}`] : [])],
    ...(observed ? { onScalarExecuted: count, onBlockExecuted: count,
        onScalarFunctionExecuted: count, onTensorKernelExecuted: count, onFunctionBodyExecuted: count } : {}),
});
const start = performance.now();
try {
    diagnostics.run(() => runtime.execute(readFileSync(file, 'utf8')));
    console.log(JSON.stringify({ file, r, x, mode, block: block ?? String(runtime.variables.get('Block')),
        ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024,
        answer: String((runtime.variables.get('Answer') ?? runtime.lastResult)), entries, d: diagnostics }));
} finally { runtime.dispose(); }
