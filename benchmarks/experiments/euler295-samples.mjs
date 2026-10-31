import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const samples = [];
for (let repeat = 0; repeat < 3; repeat++) {
    const variants = repeat % 2 ? ['vector', 'bits'] : ['bits', 'vector'];
    for (const mode of ['compiled', 'reference']) {
        for (const variant of mode === 'reference' ? ['original', 'vector'] : variants) {
            const child = spawnSync(process.execPath, ['benchmarks/euler295-investigation.mjs', mode, variant], {
                encoding: 'utf8', timeout: 60000,
            });
            const sample = child.status === 0 ? {repeat, ...JSON.parse(child.stdout)}
                : {repeat, mode, variant, status: child.status, error: String(child.error ?? child.stderr)};
            samples.push(sample);
            console.log(JSON.stringify({repeat, mode, variant, ms: sample.ms, answer: sample.answer, error: sample.error}));
            writeFileSync('benchmarks/baselines/2026-10-31-euler295-samples.json', JSON.stringify({
                node: process.version, platform: process.platform, architecture: process.arch,
                revision: 'dc006139054bfcea814da2a22d396b6947fc05cb', samples,
            }, null, 2) + '\n');
        }
    }
}
