import { spawnSync } from 'node:child_process';
import { loadavg, freemem, totalmem, cpus } from 'node:os';
const [baseline, rounds = '3', controls = 'yes'] = process.argv.slice(2);
if (!baseline) throw Error('Pass the frozen baseline interpreter out/index.js');
const variants = {
 original: ['benchmarks/fixtures/euler489-original.ra', baseline],
 demoOnly: ['demos/euler/489_commonfactors.ra', baseline],
 final: ['demos/euler/489_commonfactors.ra', undefined],
 runtimeOnly: ['benchmarks/fixtures/euler489-original.ra', undefined],
};
function run(variant, mode, round) {
 const [file, runtime] = variants[variant];
 const env = { ...process.env, RANK489_EXPECTED: '1791954757162', RANK489_DIAGNOSTICS: '0' };
 if (runtime) env.RANK489_RUNTIME = runtime; else delete env.RANK489_RUNTIME;
 const before = { load: loadavg(), freeMiB: freemem() / 2 ** 20 };
 const child = spawnSync(process.execPath, ['benchmarks/euler489.mjs', mode, '18', '1900', file],
  { env, encoding: 'utf8', maxBuffer: 2 ** 20 });
 if (child.status !== 0) throw Error(`${variant}: ${child.stderr || child.stdout}`);
 console.log(JSON.stringify({ variant, mode, round, cpuModel: cpus()[0].model,
  totalMiB: totalmem() / 2 ** 20, before, after: { load: loadavg(), freeMiB: freemem() / 2 ** 20 },
  ...JSON.parse(child.stdout) }));
}
for (let round = 0; round < Number(rounds); round++) {
 const order = round % 2 ? ['final', 'demoOnly', 'original'] : ['original', 'demoOnly', 'final'];
 for (const variant of order) if (variant !== 'demoOnly' || controls !== 'no' && round === 0) run(variant, 'compiled', round + 1);
}
if (controls !== 'no') run('runtimeOnly', 'compiled', 1);
for (const variant of ['original', 'final']) run(variant, 'reference', 1);
