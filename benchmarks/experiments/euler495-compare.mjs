import { spawnSync } from 'node:child_process';
import { cpus, loadavg, freemem } from 'node:os';
const [baseline, count = '3'] = process.argv.slice(2);
if (!baseline) throw Error('Pass the frozen baseline out/index.js');
const variants = {
    original: ['benchmarks/fixtures/euler495-original.ra', baseline],
    final: ['demos/euler/495_distinctproduct.ra', undefined],
    demoOnly: ['demos/euler/495_distinctproduct.ra', baseline],
    runtimeOnly: ['benchmarks/fixtures/euler495-original.ra', undefined],
};
function run(variant, mode, round) {
    const [file, runtime] = variants[variant];
    const env = { ...process.env, RANK495_EXPECTED: '789107601', RANK495_DIAGNOSTICS: '0' };
    delete env.RANK495_PROFILE;
    if (runtime) env.RANK495_RUNTIME = runtime; else delete env.RANK495_RUNTIME;
    const before = { load: loadavg(), freeMiB: freemem() / 2 ** 20 };
    const child = spawnSync(process.execPath, ['benchmarks/euler495.mjs', mode, '10000', '30', file], { env, encoding: 'utf8' });
    if (child.status !== 0) throw Error(child.stderr || child.stdout);
    console.log(JSON.stringify({ variant, round, cpuModel: cpus()[0].model, before,
        after: { load: loadavg(), freeMiB: freemem() / 2 ** 20 }, ...JSON.parse(child.stdout) }));
}
for (let round = 1; round <= Number(count); round++) {
    for (const variant of round % 2 ? ['original', 'final'] : ['final', 'original']) run(variant, 'compiled', round);
}
for (const variant of ['demoOnly', 'runtimeOnly']) run(variant, 'compiled', 1);
for (const variant of ['original', 'final']) run(variant, 'reference', 1);
