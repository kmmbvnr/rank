import { spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
const [baseline, rounds = '3'] = process.argv.slice(2);
if (!baseline) throw Error('Pass frozen interpreter/out/index.js');
const cases = [
    { task: 482, args: ['compiled', '10000000'], expected: '1400824879147' },
    { task: 483, args: ['compiled', '350'], expected: '4.993401567e22' },
];
const runs = [];
for (const item of cases) for (let round = 0; round < Number(rounds); round++) {
    for (const variant of round % 2 ? ['final', 'baseline'] : ['baseline', 'final']) {
        const env = { ...process.env }, key = `RANK${item.task}_RUNTIME`;
        if (variant === 'baseline') env[key] = baseline; else delete env[key];
        env[`RANK${item.task}_EXPECTED`] = item.expected;
        const started = new Date().toISOString(), load = loadavg();
        const result = spawnSync(process.execPath, [`benchmarks/euler${item.task}.mjs`, ...item.args],
            { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        if (result.status !== 0) throw Error(result.stderr || String(result.error));
        const value = JSON.parse(result.stdout);
        if (value.answer !== item.expected) throw Error('Wrong answer');
        runs.push({ task: item.task, round, variant, started, load, ...value });
        process.stderr.write(`${item.task} ${round} ${variant}: ${value.ms.toFixed(1)} ms ${value.rssMiB.toFixed(1)} MiB\n`);
    }
}
console.log(JSON.stringify({ node: process.version, arch: process.arch, rounds: Number(rounds), runs }, null, 2));
