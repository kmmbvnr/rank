import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Build first; each sample runs in a fresh process. --outer also measures
// the full Cartesian product, which needs substantially more memory.
const worker = process.argv.indexOf('--worker');
if (worker >= 0) {
    const mode = process.argv[worker + 1];
    const variant = process.argv[worker + 2];
    const { Interpreter, withInterrupt } = await import(process.env.RANK023_RUNTIME
        ?? new URL('../packages/interpreter/out/index.js', import.meta.url).href);
    const source = readFileSync(new URL('../demos/euler/023_abundantsums.ra', import.meta.url), 'utf8')
        .replace('arg Limit integer = 28123', 'Limit = 28123');
    const boundary = source.indexOf('rem Mark every');
    const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference' });
    const words = new Int32Array(new SharedArrayBuffer(12));
    // Model Android's observable signal API; this measures interpreter work,
    // without the phone's synchronous HTTP polling or WebView overhead.
    const signal = mode === 'mobile' ? {
        length: 3, load: index => words[index],
        store: (index, value) => { words[index] = value; },
        exchange(index, value) { const old = words[index]; words[index] = value; return old; },
        wait() { throw new Error('unexpected pause'); },
    } : words;
    const execute = text => mode === 'inspection' || mode === 'mobile'
        ? withInterrupt(signal, () => runtime.execute(text), () => {}) : runtime.execute(text);
    try {
        let start = performance.now();
        execute(source.slice(0, boundary));
        const sieveMs = performance.now() - start;
        start = performance.now();
        const cpu = process.cpuUsage();
        execute(variant === 'outer' ? `Grid = Abundant Abundant outer + reshape #
Valid = Grid (Grid at most Limit)
Pairs = array shape (Limit + 1) fill false
Pairs Valid = true
Answer = (not Pairs) indices sum` : source.slice(boundary));
        const pairsMs = performance.now() - start;
        const pairsCpuMs = Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b) / 1000;
        assert.equal((runtime.variables.get('Answer') ?? runtime.lastResult), 4179871n);
        console.log(JSON.stringify({ mode, variant, sieveMs, pairsMs, pairsCpuMs, totalMs: sieveMs + pairsMs,
            rssMiB: process.resourceUsage().maxRSS / 1024, answer: '4179871' }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(process.argv.find(arg => /^--trials=/.test(arg))?.split('=')[1] ?? 3);
    assert(Number.isSafeInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, arch: process.arch, platform: process.platform, trials }));
    for (const mode of ['turbo', 'reference', 'inspection', 'mobile']) {
        for (const variant of process.argv.includes('--outer') ? ['original', 'outer'] : ['original']) {
            for (let trial = 0; trial < trials; trial++) {
                const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', mode, variant],
                    { encoding: 'utf8', timeout: 120000 });
                assert.equal(result.status, 0, result.stderr || result.error?.message);
                console.log(JSON.stringify({ trial, ...JSON.parse(result.stdout) }));
            }
        }
    }
}
