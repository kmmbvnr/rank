// Build the selected checkout first. Fresh processes, no timing assertions in CI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const option = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
};
const root = resolve(option('--root', resolve(import.meta.dirname, '..')));
// Fixtures live beside this driver, so --root changes only the runtime.
const cases = {
    recursive103: ['programs/search-loops/recursive103.ra', '20313839404245'],
    depth103: ['programs/search-loops/depth103.ra', '20313839404245'],
    demo103: ['../demos/euler/103_specialsubset.ra', '20313839404245'],
    recursive88: ['programs/search-loops/recursive88.ra', '7587457'],
    batch88: ['../demos/euler/088_productsum.ra', '7587457'],
    stack88: ['../demos/euler/088_productsum_stack.ra', '7587457'],
};
const expectedWork = { recursive103: '461956', depth103: '557641', demo103: '557641',
    recursive88: '421978', batch88: '421978', stack88: '421978' };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (process.argv.includes('--worker')) {
    const name = option('--worker');
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')).href);
    const executed = { loop: 0, scalar: 0, scalarFunction: 0, block: 0, tensor: 0 };
    const runtime = new Interpreter(() => {}, {
        onIntegerLoopExecuted: () => executed.loop++, onScalarExecuted: () => executed.scalar++,
        onScalarFunctionExecuted: () => executed.scalarFunction++, onBlockExecuted: () => executed.block++,
        onTensorKernelExecuted: () => executed.tensor++,
    });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const [file, expected] = cases[name];
        let source = readFileSync(new URL(file, import.meta.url), 'utf8');
        const counted = process.argv.includes('--count');
        if (counted) {
            const needle = name.includes('103') || name === 'demo103'
                ? name === 'recursive103' ? '  for X in Last + 1 till Cap\n' : 'for Depth greater -1\n'
                : name === 'recursive88' ? 'fun Prod Sum Cnt Low search\n' : name === 'stack88' ? '  Frame = Todo pop\n' : 'for Prod len greater 0\n';
            assert.ok(source.includes(needle));
            source = 'Work = array 0\n' + source.replace(needle, needle + (name === 'batch88' ? '  Work 0 += Prod len\n' : '  Work 0 += 1\n'));
        }
        const start = performance.now();
        diagnostics.run(() => runtime.execute(source));
        const executeMs = performance.now() - start;
        assert.equal(String(runtime.variables.get('Answer')), expected);
        if (name.includes('103')) {
            assert.equal(String(runtime.execute('Found sum')), '255');
        }
        const work = counted ? String(runtime.execute('Work 0')) : undefined;
        if (counted) assert.equal(work, expectedWork[name]);
        console.log(JSON.stringify({ executeMs, maxRSSMiB: process.resourceUsage().maxRSS / 1024,
            work, executed,
            compiledLoops: diagnostics.compiledLoops, cowCopies: diagnostics.cowCopies }));
    } finally { runtime.dispose(); }
} else {
    const names = option('--case') ? option('--case').split(',') : Object.keys(cases);
    const results = {};
    for (const name of names) {
        assert.ok(cases[name], `Unknown case ${name}`);
        const samples = [];
        for (let run = 0; run < Number(option('--runs', '3')); run++) {
            const start = performance.now();
            const worker = spawnSync(process.execPath,
                [import.meta.filename, '--root', root, '--worker', name], { encoding: 'utf8' });
            assert.equal(worker.status, 0, worker.stderr);
            samples.push({ processMs: performance.now() - start, ...JSON.parse(worker.stdout) });
        }
        const counted = spawnSync(process.execPath,
            [import.meta.filename, '--root', root, '--worker', name, '--count'], { encoding: 'utf8' });
        assert.equal(counted.status, 0, counted.stderr);
        results[name] = { samples, work: JSON.parse(counted.stdout).work,
            medianExecuteMs: median(samples.map(s => s.executeMs)),
            medianMaxRSSMiB: median(samples.map(s => s.maxRSSMiB)) };
        console.error(`${name}: ${results[name].medianExecuteMs.toFixed(1)} ms execute, ${results[name].work} work`);
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, root, results }, null, 2));
}
