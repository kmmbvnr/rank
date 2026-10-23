// Build first. Each sample runs in a fresh process and checks its result.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.slice(2).split('=')));
const root = resolve(import.meta.dirname, '..');
if (options.worker && options.program === 'oracle') {
    const { moonOracle } = await import('./lib/euler353-oracle.mjs');
    const last = Number(options.last ?? 5), start = performance.now();
    const risks = Array.from({ length: last }, (_, i) => moonOracle(2 ** (i + 1) - 1, true));
    const result = Number(risks.reduce((sum, value) => sum + value, 0).toFixed(10));
    console.log(JSON.stringify({ program: 'oracle', last, ms: performance.now() - start, result, risks }));
} else if (options.worker) {
    const { Interpreter } = await import(pathToFileURL(resolve(options.runtime ?? root, 'packages/interpreter/out/index.js')));
    const original = options.program === 'original';
    let source = readFileSync(resolve(root, original ? 'benchmarks/fixtures/euler353-original.ra' : 'demos/euler/353_riskymoon.ra'), 'utf8');
    const last = Number(options.last ?? 5);
    if (options.radii === 'true') {
        source = source.replace('Sum = 0.0', 'Risks = array shape Last fill 0.0\nSum = 0.0')
            .replace('  Sum += (2 ** N - 1) moon', '  Risk = (2 ** N - 1) moon\n  Risks (N - 1) = Risk\n  Sum += Risk');
    }
    const runtime = new Interpreter(() => {}, { args: ['--last', String(last)] });
    try {
        const start = performance.now();
        runtime.execute(source);
        const ms = performance.now() - start;
        const result = runtime.variables.get('Answer');
        const expected = { 5: 1.1091333145, 8: 1.220942742, 9: 1.2388476315, 15: 1.2759860331 }[last];
        if (expected !== undefined) assert.equal(result, expected);
        assert.equal(typeof result, 'number');
        if (options.radii === 'true') {
            // Independent unpruned oracle, also reproducible with --program=oracle.
            const expectedRisks = [0.5, 0.23604566644613517, 0.17849439975514858,
                0.10714794796211999, 0.08744530034378607, 0.04151568414918859,
                0.046342185231883506, 0.023951558104512362, 0.017904889542828213,
                0.010340579258887032, 0.010981092024029226, 0.0050289498357206155,
                0.005600730815026471, 0.0029262924103760444, 0.0022607571996446575];
            const risks = runtime.variables.get('Risks').items;
            assert.equal(risks.length, last);
            risks.forEach((risk, i) => assert(Math.abs(risk - expectedRisks[i]) < 1e-14, `radius ${2 ** (i + 1) - 1}`));
        }
        console.log(JSON.stringify({ program: options.program ?? 'reduced', last, ms, result, rssMiB: process.memoryUsage().rss / 2 ** 20 }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    const times = [];
    for (let sample = 0; sample < Number(options.samples ?? 3); sample++) {
        const child = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2), '--worker=1'], {
            encoding: 'utf8', timeout: Number(options.timeout ?? 60000),
        });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout);
        times.push(result.ms);
        console.log(JSON.stringify({ sample, ...result }));
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ medianMs: times[Math.floor(times.length / 2)] }));
}
