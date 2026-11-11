import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [checkout, file, ...args] = process.argv.slice(2);
const root = resolve(checkout);
const {Interpreter, RuntimeDiagnostics} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const output = [], runtime = new Interpreter(text => output.push(text), {args});
const diagnostics = new RuntimeDiagnostics();
try {
    diagnostics.run(() => runtime.execute(readFileSync(resolve(root, file), 'utf8')));
    const counters = Object.fromEntries(Object.entries(diagnostics).filter(([, value]) => typeof value === 'number'));
    console.log(JSON.stringify({file, args, output, counters, fallbacks: diagnostics.fallbacks}));
} finally { runtime.dispose(); }
