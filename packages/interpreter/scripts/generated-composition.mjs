import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const options = { seed: '565', count: '64', timeout: '120000' };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '');
    if (!['seed', 'count', 'case', 'report', 'failures', 'timeout'].includes(key) || args[index + 1] === undefined) {
        throw new Error('Usage: npm run test:generated -- [--seed UINT32] [--count 1..4096] [--case INDEX] [--report PATH] [--failures DIR] [--timeout MS]');
    }
    options[key] = args[index + 1];
}
const seed = Number(options.seed), count = Number(options.count), start = Number(options.case ?? 0), timeout = Number(options.timeout);
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(count) || count < 1 || count > 4096
    || !Number.isSafeInteger(start) || start < 0 || start > 1000000 || !Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600000) {
    throw new Error('Invalid seed, case count/index or timeout (1000..600000 ms)');
}
const env = { ...process.env, RANK_GENERATED_SEED: String(seed), RANK_GENERATED_CASES: options.case === undefined ? String(count) : '1',
    RANK_GENERATED_START: String(start) };
if (options.report) {
    env.RANK_GENERATED_REPORT = resolve(options.report);
    rmSync(env.RANK_GENERATED_REPORT, { force: true });
}
if (options.failures) env.RANK_GENERATED_FAILURE_DIR = resolve(options.failures);
const child = spawn(process.execPath, ['scripts/test.mjs', 'test/generated-composition.test.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit', detached: process.platform !== 'win32',
});
let timedOut = false;
const timer = setTimeout(() => {
    timedOut = true;
    console.error(`Generated suite exceeded ${timeout} ms; terminating process group ${child.pid}.`);
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
}, timeout);
child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timer); process.exitCode = timedOut ? 1 : code ?? 1; });
