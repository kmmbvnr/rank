import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(operators|samples|cli|baseline|euler-source)=(.+)$/.exec(arg);
    if (!match) throw Error(`Unknown option: ${arg}`);
    return [match[1], match[2]];
}));
const cli = resolve(options.cli ?? 'packages/cli/bin/cli.js');
const runtimes = { candidate: cli, ...(options.baseline ? { baseline: resolve(options.baseline) } : {}) };
const revision = executable => execFileSync('git', ['-C', resolve(executable, '../../../..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const revisions = Object.fromEntries(Object.entries(runtimes).map(([name, executable]) => [name, revision(executable)]));
const samples = Number(options.samples ?? 3);
assert(Number.isInteger(samples) && samples >= 3);
const expressions = { add: 'X + Z', min: 'X min Z', max: 'X max Z', choose: 'M choose X Z' };
const names = (options.operators ?? Object.keys(expressions).join(',')).split(',');
assert(names.every(name => name in expressions));
const directory = mkdtempSync(join(tmpdir(), 'rank-integer-selection-'));
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, cells: 1600000, passes: 20, samples, runtimes, revisions,
    timing: 'fresh CLI processes; subtract setup median and divide by 20; includes copy and sum' }));
try {
    for (let trial = 0; trial < samples; trial++) {
        const cases = ['setup', ...names, ...(options['euler-source'] ? ['euler414'] : [])];
        for (const name of trial % 2 ? cases.reverse() : cases) {
            let args;
            if (name === 'euler414') args = [options['euler-source'], '--first', '300', '--last', '300'];
            else {
                const body = name === 'setup' ? 'S += 0' : `Y = (${expressions[name]}) copy\n S += Y sum`;
                const source = `use numbers\nuse sequences\nuse io\nN = 1600000\nX = (0 to N - 1) copy\nZ = (X mod 1000) copy\nM = (X equal Z) copy\nS = 0\nfor R in 1 to 20\n ${body}\nend\nS print\n`;
                const path = join(directory, 'stored-integer-' + name + '.ra');
                writeFileSync(path, source);
                args = [path];
            }
            const versions = Object.entries(runtimes);
            for (const [version, executable] of trial % 2 ? versions.reverse() : versions) {
                const start = performance.now();
                const result = spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', timeout: 60000 });
                const ms = performance.now() - start;
                assert.ifError(result.error);
                assert.equal(result.status, 0, result.stderr);
                const answer = result.stdout.trim();
                const expected = { setup: '0', add: '25615968000000', min: '15984000000', max: '25599984000000',
                    choose: '15984000000', euler414: '334961735971658529' };
                assert.equal(answer, expected[name]);
                console.log(JSON.stringify({ trial, version, name, ms, answer }));
            }
        }
    }
    for (const [name, executable] of Object.entries(runtimes)) assert.equal(revision(executable), revisions[name], `${name} checkout changed during the benchmark`);
} finally { rmSync(directory, { recursive: true, force: true }); }
