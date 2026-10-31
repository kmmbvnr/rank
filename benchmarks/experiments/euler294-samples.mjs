import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const samples = [];
for (let repeat = 0; repeat < 3; repeat++) {
    for (const mode of ['compiled', 'reference']) {
        for (const variant of repeat % 2 ? ['periodic', 'original'] : ['original', 'periodic']) {
            const child = spawnSync(process.execPath, ['benchmarks/euler294-investigation.mjs', mode, variant], {
                encoding: 'utf8', timeout: 120000,
            });
            assert.equal(child.status, 0, child.stderr);
            const sample = {repeat, ...JSON.parse(child.stdout)};
            samples.push(sample);
            console.log(JSON.stringify(sample));
        }
    }
}
writeFileSync('benchmarks/baselines/2026-10-31-euler294-samples.json', JSON.stringify({
    revision: '42c9271bc5942dbf906d42319099a52fd3a74599',
    node: process.version, platform: process.platform, architecture: process.arch,
    description: 'Fresh serial processes; interpreter construction/startup excluded, parse/JIT included; uncontrolled host load.',
    samples,
}, null, 2) + '\n');
