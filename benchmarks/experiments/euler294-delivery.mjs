import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {Interpreter} from '../../packages/interpreter/out/index.js';

if (process.argv[2] === 'child') {
    const [, , , mode, fixture] = process.argv;
    const file = resolve(`demos/euler/294_sumofdigits${fixture === 'true' ? '_test' : ''}.ra`);
    const runtime = new Interpreter(() => {}, {
        compilation: mode === 'compiled', sourceId: file, testing: true,
        loadModule: (specifier, fromId) => {
            const id = resolve(dirname(fromId ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return {id, source: readFileSync(id, 'utf8')};
        },
    });
    const start = performance.now();
    try {
        runtime.execute(readFileSync(file, 'utf8'));
        if (fixture === 'true') {
            assert.equal(runtime.testResults.length, 4);
            for (const result of runtime.testResults) assert.equal(result.passed, true, JSON.stringify(result));
        } else assert.equal(runtime.variables.get('Answer'), 789184709n);
        console.log(JSON.stringify({mode, fixture: fixture === 'true', ms: performance.now() - start,
            rssMiB: process.resourceUsage().maxRSS / 1024}));
    } finally {runtime.dispose();}
} else {
    const samples = [];
    for (let repeat = 0; repeat < 3; repeat++) {
        for (const mode of ['compiled', 'reference']) for (const fixture of [false, true]) {
            const child = spawnSync(process.execPath, [process.argv[1], 'child', mode, String(fixture)], {
                encoding: 'utf8', timeout: 120000,
            });
            assert.equal(child.status, 0, child.stderr);
            const sample = {repeat, ...JSON.parse(child.stdout)};
            samples.push(sample);
            console.log(JSON.stringify(sample));
        }
    }
    writeFileSync('benchmarks/baselines/2026-10-31-euler294-delivery.json', JSON.stringify({
        node: process.version, platform: process.platform, architecture: process.arch, samples,
    }, null, 2) + '\n');
}
