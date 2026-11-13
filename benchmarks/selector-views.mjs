import { pathToFileURL } from 'node:url';
const selected = process.env.RANK_SELECTOR_RUNTIME;
const { Interpreter } = await import(selected ? pathToFileURL(selected)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'reference'] = process.argv.slice(2);
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference' });
try {
    runtime.execute('use sequences\nSize = 1000000\nMask = array shape Size fill true\nValues = 0 till Size copy');
    const start = performance.now(), cpu = process.cpuUsage();
    for (let i = 0; i < 10; i++) runtime.execute('Answer = Values (Mask (0 till Size)) sum');
    const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
    if (answer !== '499999500000') throw Error(`Wrong answer: ${answer}`);
    console.log(JSON.stringify({ mode, node: process.version, arch: process.arch,
        ms: performance.now() - start, cpu: process.cpuUsage(cpu),
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, runtime: selected ?? 'current' }));
} finally { runtime.dispose(); }
