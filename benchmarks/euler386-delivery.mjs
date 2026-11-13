import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter, RuntimeDiagnostics} = await import(new URL(
    process.env.RUNTIME || '../packages/interpreter/out/index.js', import.meta.url));
const [file = 'demos/euler/386_antichain.ra', limit = '100000000', mode = 'compiled'] = process.argv.slice(2);
const diagnostics = new RuntimeDiagnostics();
let calls = 0;
const runtime = new Interpreter(() => {}, {
    compilation: mode !== 'reference', args: [`--limit=${limit}`], onScalarFunctionExecuted: () => calls++,
});
try {
    const source = readFileSync(file, 'utf8'), start = performance.now();
    if (process.env.DIAG) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const ms = performance.now() - start, answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    const expected = {0:'0',1:'1',2:'2',6:'7',7:'8',8:'9',10:'12',100:'178',1000:'2385',1000000:'4153927',100000000:'528755790'}[limit];
    if (expected !== undefined && !process.env.ORIGINAL) assert.equal(answer, expected);
    console.log(JSON.stringify({file, limit, mode, answer, ms, rssMiB: process.resourceUsage().maxRSS / 1024,
        calls, ...(process.env.DIAG ? {diagnostics} : {})}));
} finally {runtime.dispose();}
