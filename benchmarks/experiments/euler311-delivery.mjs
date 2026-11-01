import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {arch, cpus, platform} from 'node:os';
import {fileURLToPath} from 'node:url';

const [output, limit = '10000000000', rounds = '3'] = process.argv.slice(2);
if (!output) throw Error('output [limit] [rounds]');
const harness = fileURLToPath(new URL('../euler311-investigation.mjs', import.meta.url));
const source = readFileSync(new URL('../../demos/euler/311_biclinic.ra', import.meta.url));
const data = {node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model,
    sourceHash: createHash('sha256').update(source).digest('hex'),
    method: 'Fresh serial processes; imports excluded, parse and execution included; RSS is process high-water.', rows: []};
for (let round = 0; round < Number(rounds); round++) {
    const env = {...process.env};
    delete env.RANK_BENCH_RUNTIME;
    const run = spawnSync(process.execPath, [harness, 'compiled', limit, '1000000'], {
        env, encoding: 'utf8', timeout: 600000,
    });
    if (run.status !== 0) throw Error(run.stderr || `exit ${run.status}`);
    const row = {round, ...JSON.parse(run.stdout)};
    if (limit === '100000000' && row.answer !== '11548848') throw Error('reduced answer mismatch');
    if (row.diagnostics.numberFunctionFallbacks !== 0) throw Error('unexpected Number fallback');
    if (row.diagnostics.numberFunctions !== Math.ceil(Number(limit) / 4 / 1000000)) throw Error('missing Number helper entries');
    data.rows.push(row);
    writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
}
const median = key => data.rows.map(row => row[key]).sort((a, b) => a - b)[Math.floor(data.rows.length / 2)];
console.log(JSON.stringify({limit, rounds, ms: median('ms'), rssMiB: median('rssMiB')}));
