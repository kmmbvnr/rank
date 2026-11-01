import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {cpus, platform, arch} from 'node:os';
import {fileURLToPath} from 'node:url';

const [runtime, output, limit = '100000000', rounds = '3'] = process.argv.slice(2);
if (!runtime || !output) throw Error('prototype-runtime output [limit] [rounds]');
const harness = fileURLToPath(new URL('../euler311-investigation.mjs', import.meta.url));
const cases = [
    ['original', 'compiled', 'original', '4000000', false],
    ['prototype', 'compiled', 'original', '4000000', true],
    ['prototype-block1m', 'compiled', 'original', '1000000', true],
    ['prefix', 'prefix', 'original', '4000000', false],
    ['inline', 'compiled', 'inline', '4000000', false],
    ['online-prefix', 'prefix', 'online', '4000000', false],
    ['online-prototype', 'compiled', 'online', '4000000', true],
    ['online-prototype-block1m', 'compiled', 'online', '1000000', true],
];
const result = {node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model, rows: []};
for (let round = 0; round < Number(rounds); round++) {
    for (let i = 0; i < cases.length; i++) {
        const [name, mode, variant, block, prototype] = cases[(i + round) % cases.length];
        const env = {...process.env};
        delete env.RANK_BENCH_RUNTIME;
        if (prototype) env.RANK_BENCH_RUNTIME = runtime;
        const run = spawnSync(process.execPath, [harness, mode, limit, block, variant], {
            env, encoding: 'utf8', timeout: 600000,
        });
        if (run.status !== 0) throw Error(run.stderr || `exit ${run.status}`);
        const row = {round, name, ...JSON.parse(run.stdout)};
        if (limit === '100000000' && row.answer !== '11548848') throw Error('answer mismatch');
        result.rows.push(row);
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
}
for (const [name] of cases) {
    const rows = result.rows.filter(row => row.name === name);
    const median = key => rows.map(row => row[key]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    console.log(JSON.stringify({name, ms: median('ms'), rssMiB: median('rssMiB')}));
}
