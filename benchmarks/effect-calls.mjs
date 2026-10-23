// Build first: npm run build
// node benchmarks/effect-calls.mjs [--samples=5] [--diagnostics] [--baseline=/path/to/out/index.js]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[2] === '--worker') {
    const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice('--baseline='.length);
    const { Interpreter, RuntimeDiagnostics } = await import(baseline ? pathToFileURL(resolve(baseline)).href
        : '../packages/interpreter/out/index.js');
    const workload = process.argv[3];
    const diagnostics = process.argv.includes('--diagnostics') ? new RuntimeDiagnostics() : undefined;
    const source = workload === 'euler346'
        ? readFileSync(new URL('../demos/euler/346_strongrepunits.ra', import.meta.url), 'utf8')
        : 'use graph\nGraph = new graph .directed\nfor I in 1 to 100000\n Graph add 0 (I mod 1000)\nend';
    const runtime = new Interpreter(() => {});
    try {
        const start = performance.now();
        if (diagnostics) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const ms = performance.now() - start;
        const answer = workload === 'euler346' ? String(runtime.variables.get('Answer'))
            : String(runtime.variables.get('Graph').outgoingEdges(0n).length);
        assert.equal(answer, workload === 'euler346' ? '336108797689259276' : '100000');
        console.log(JSON.stringify({ workload, variant: baseline ? 'baseline' : 'candidate', ms, answer, peakRssKiB: process.resourceUsage().maxRSS,
            ...(diagnostics && { compiledLoops: diagnostics.compiledLoops, numberLoops: diagnostics.numberLoops,
                effectCalls: diagnostics.compiledEffectCalls, graphAdds: diagnostics.compiledGraphAdds }) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(process.argv.find(value => value.startsWith('--samples='))?.split('=')[1] ?? 5);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const diagnostics = process.argv.includes('--diagnostics');
    const baseline = process.argv.find(value => value.startsWith('--baseline='));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, samples, diagnostics,
        timing: 'Fresh process per sample; parse/compile/execute included; imports and answer validation excluded' }));
    for (const workload of ['euler346', 'graph']) {
        const results = new Map();
        for (let sample = 0; sample < samples; sample++) {
            const variants = baseline ? sample % 2 ? [undefined, baseline] : [baseline, undefined] : [undefined];
            for (const variant of variants) {
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', workload,
                    ...(diagnostics ? ['--diagnostics'] : []), ...(variant ? [variant] : [])],
                    { cwd: root, encoding: 'utf8', timeout: 30000 });
                assert.ifError(child.error);
                assert.equal(child.status, 0, child.stderr);
                const result = JSON.parse(child.stdout);
                const times = results.get(result.variant) ?? [];
                times.push(result.ms);
                results.set(result.variant, times);
                console.log(JSON.stringify(result));
            }
        }
        for (const [variant, times] of results) {
            times.sort((a, b) => a - b);
            console.log(JSON.stringify({ workload, variant, medianMs: times[Math.floor(times.length / 2)] }));
        }
    }
}
