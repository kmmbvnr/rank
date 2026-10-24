// node benchmarks/loop-range-values.mjs --samples=3 --iterations=5000
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../packages/interpreter/out/index.js';
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const iterations = Number(option('iterations', '5000'));
const samples = Number(option('samples', '3'));
const cases = {
    range: 'Ix = J to 3 * J by J\n Total += Ix 0',
    steppedRead: 'B = A (J to 3 * J by J)\n Total += B 0',
    quotientRead: 'B = A ((J to 9) // 2)\n Total += B 0',
    arrayWrite: 'A (1 to 3) = (A (1 to 3) - 1) mod 7\n Total += A 1',
    rangeCopy: 'Ib = (J to 9) copy\n Total += Ib 0',
};
if (process.argv.includes('--child')) {
    const body = cases[option('case', 'range')];
    const runtime = new Interpreter(undefined, { compilation: option('compiled', 'true') !== 'false', scalarEntryCompilation: false });
    try {
        runtime.execute(`use sequences\nfun N trial\n A = array shape 20 fill 7\n Total = 0\n for K in 1 to N\n J = (K mod 5) + 1\n ${body}\n end\n return Total + A 1\nend`);
        runtime.execute('Result = 100 trial');
        const diagnostics = new RuntimeDiagnostics();
        const start = performance.now();
        diagnostics.run(() => runtime.execute(`Result = ${iterations} trial`));
        const ms = performance.now() - start;
        console.log(JSON.stringify({ ms, checksum: formatValue(runtime.variables.get('Result')), compiledLoops: diagnostics.compiledLoops, fallbacks: diagnostics.fallbacks }));
    } finally { runtime.dispose(); }
} else {
    const results = {};
    for (const name of option('cases', Object.keys(cases).join(',')).split(',')) {
        const variants = {};
        for (const compiled of ['true', 'false']) {
            const runs = Array.from({ length: samples }, () => {
                const child = spawnSync(process.execPath, [import.meta.filename, '--child', `--case=${name}`, `--iterations=${iterations}`, `--compiled=${compiled}`], { encoding: 'utf8' });
                assert.equal(child.status, 0, child.stderr || child.stdout);
                return JSON.parse(child.stdout);
            });
            variants[compiled] = { medianMs: runs.map(run => run.ms).sort((a, b) => a - b)[Math.floor(samples / 2)], runs };
        }
        for (const run of variants.true.runs) assert.equal(run.checksum, variants.false.runs[0].checksum);
        results[name] = variants;
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, iterations, samples, results }, null, 2));
}
