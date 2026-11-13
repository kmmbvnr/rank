import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK566_RUNTIME;
const { Interpreter, RuntimeDiagnostics } = await import(chosen ? pathToFileURL(chosen)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const count = Number(process.argv[2] ?? 1000000);
const mode = process.argv[3] ?? 'append';
if (!['append', 'overwrite', 'read'].includes(mode)) throw Error('expected append, overwrite or read');
if (!Number.isSafeInteger(count) || count < 1) throw Error('positive integer count required');
const runtime = new Interpreter(() => {}), diagnostics = process.env.RANK566_DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
try {
    runtime.execute('use algo\nValues = new index\nValues 0 = 7\nValues -1 = 8\nValues -2 = 9');
    runtime.variables.set('Count', BigInt(count));
    const source = mode === 'append' ? 'for I in 1 to Count\n Values I = I\nend\nAnswer = Values Count'
        : mode === 'overwrite' ? 'for I in 1 to Count\n Values 0 = I\nend\nAnswer = Values 0'
        : 'Answer = 0\nfor I in 1 to Count\n Answer += Values 0\nend';
    const start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    if ((runtime.variables.get('Answer') ?? runtime.lastResult) !== BigInt(count) * (mode === 'read' ? 7n : 1n)) throw Error('wrong final index value');
    console.log(JSON.stringify({ count, mode, ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, diagnostics }));
} finally { runtime.dispose(); }
