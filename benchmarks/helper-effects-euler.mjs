import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const cases = [
    ['026_reciprocal.ra', '983'],
    ['044_pentagondiff.ra', '5482660'],
    ['303_smalldigits.ra', '1111981904675169'],
    ['330_eulerian.ra', '15955822'],
    ['310_nimsquare.ra', '2586528661783'],
];
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[2] === '--worker') {
    const [, , , checkout, file, diagnostics] = process.argv;
    const expected = cases.find(([name]) => name === file)[1];
    // Both versions execute the identical, unmodified candidate demo.
    const source = readFileSync(resolve(root, 'demos/euler', file), 'utf8');
    const {Interpreter, RuntimeDiagnostics, parse} = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const outputs = [];
    const runtime = new Interpreter(value => outputs.push(String(value)));
    const program = parse(source);
    const stats = diagnostics === 'on' ? new RuntimeDiagnostics() : undefined;
    global.gc();
    const start = performance.now();
    try {
        if (stats) stats.run(() => runtime.executeProgram(program));
        else runtime.executeProgram(program);
        const milliseconds = performance.now() - start;
        const answer = outputs.join('').trim();
        assert.equal(answer, expected);
        global.gc();
        const memory = process.memoryUsage();
        console.log(JSON.stringify({milliseconds, answer,
            sourceHash: createHash('sha256').update(source).digest('hex'),
            peakRssKiB: process.resourceUsage().maxRSS,
            retainedHeap: memory.heapUsed, retainedBuffers: memory.arrayBuffers,
            numberLoops: stats?.numberLoops, mixedLoops: stats?.mixedIntegerLoops,
            numberFunctions: stats?.numberFunctions,
            numberFunctionFallbacks: stats?.numberFunctionFallbacks,
            fallbacks: stats?.fallbacks}));
    } finally {runtime.dispose();}
} else {
    const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
    if (!baseline) throw Error('Pass --baseline=/path/to/built/checkout');
    const observations = [];
    for (const [file] of cases) for (let sample = 0; sample < 4; sample++) {
        const diagnostics = sample === 3 ? 'on' : 'off';
        const versions = sample % 2 ? [['candidate', root], ['baseline', baseline]] : [['baseline', baseline], ['candidate', root]];
        for (const [version, checkout] of versions) {
            const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', checkout, file, diagnostics],
                {encoding: 'utf8', timeout: 180000});
            if (child.status !== 0) throw Error(child.stderr || String(child.error));
            observations.push({file, version, sample, diagnostics, ...JSON.parse(child.stdout)});
        }
    }
    console.log(JSON.stringify({cpu: cpus()[0].model, node: process.version, samples: 3,
        warmups: 0, fullDefaults: true, observations}, null, 2));
}
