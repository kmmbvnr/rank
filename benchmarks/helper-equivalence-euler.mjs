import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const cases = [
    ['054_poker.ra', '376'],
    ['263_engineersdream.ra', '2039506520'],
    ['326_modulosums.ra', '1966666166408794329'],
    ['352_bloodtests.ra', '378563.260589'],
    ['399_squarefree.ra', '1508395636674243,6.5e27330467'],
    ['026_reciprocal.ra', '983'],
    ['044_pentagondiff.ra', '5482660'],
    ['303_smalldigits.ra', '1111981904675169'],
    ['330_eulerian.ra', '15955822'],
    ['310_nimsquare.ra', '2586528661783'],
];
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[2] === '--worker') {
    const [, , , checkout, file, diagnostics, warmups = 0] = process.argv;
    const expected = cases.find(([name]) => name === file)[1];
    // Both versions execute the identical, unmodified candidate demo.
    const source = readFileSync(resolve(root, 'demos/euler', file), 'utf8');
    const {Interpreter, RuntimeDiagnostics, parse} = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const outputs = [];
    const runtime = new Interpreter(value => outputs.push(String(value)), {
        io: { read: path => readFileSync(resolve(root, path)) },
    });
    const program = parse(source);
    const stats = diagnostics === 'on' ? new RuntimeDiagnostics() : undefined;
    for (let warmup = 0; warmup < Number(warmups); warmup++) {
        runtime.executeProgram(program);
        assert.equal(outputs.join('').trim(), expected);
        outputs.length = 0;
    }
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
            numberLoopOverflows: stats?.numberLoopOverflows,
            numberFunctionArrayBorrows: stats?.numberFunctionArrayBorrows,
            numberLoops: stats?.numberLoops, mixedLoops: stats?.mixedIntegerLoops,
            numberFunctions: stats?.numberFunctions,
            numberFunctionFallbacks: stats?.numberFunctionFallbacks,
            fallbacks: stats?.fallbacks}));
    } finally {runtime.dispose();}
} else {
    const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
    if (!baseline) throw Error('Pass --baseline=/path/to/built/checkout');
    const observations = [];
    const warmups = Number(process.argv.find(arg => arg.startsWith('--warmups='))?.slice(10) ?? 0);
    const samples = Number(process.argv.find(arg => arg.startsWith('--samples='))?.slice(10) ?? 3);
    const selected = process.argv.find(arg => arg.startsWith('--cases='))?.slice(8).split(',');
    for (const [file] of cases.filter(([file]) => !selected || selected.includes(file.slice(0,3)))) for (let sample = 0; sample <= samples; sample++) {
        const diagnostics = sample === samples ? 'on' : 'off';
        const versions = sample % 2 ? [['candidate', root], ['baseline', baseline]] : [['baseline', baseline], ['candidate', root]];
        for (const [version, checkout] of versions) {
            const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', checkout, file, diagnostics, String(warmups)],
                {encoding: 'utf8', timeout: 600000});
            if (child.status !== 0) throw Error(child.stderr || String(child.error));
            process.stderr.write(`${file} ${version} ${sample} completed\n`);
            observations.push({file, version, sample, diagnostics, ...JSON.parse(child.stdout)});
        }
    }
    console.log(JSON.stringify({cpu: cpus()[0].model, node: process.version, samples,
        warmups, fullDefaults: true, observations}, null, 2));
}
