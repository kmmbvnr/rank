import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = {
    types: { file: 'test/types.test.ts', prefix: 'RANK_TYPE_AUDIT', check: 'check-type-audit.mjs' },
    differential: { file: 'test/differential.test.ts', prefix: 'RANK_DIFFERENTIAL', check: 'check-differential.mjs' },
    names: { file: 'test/name-facts-corpus.test.ts', prefix: 'RANK_NAME_FACTS', check: 'check-name-facts.mjs' },
};

/** CI already shards across jobs; local runs leave CPU and memory for the host. */
export function localDemoWorkers(env = process.env, cpus = availableParallelism(), memory = totalmem()) {
    if (env.CI && env.CI !== 'false') return 1;
    if (env.RANK_DEMO_WORKERS !== undefined) {
        const count = Number(env.RANK_DEMO_WORKERS);
        if (!Number.isSafeInteger(count) || count < 1) throw new Error('RANK_DEMO_WORKERS must be a positive integer');
        return count;
    }
    return Math.max(1, Math.min(cpus - 1, Math.floor(memory / (2 * 1024 ** 3))));
}

export function canShardLocally(kind, env = process.env) {
    return env[`${suites[kind].prefix}_SHARDS`] === undefined && localDemoWorkers(env) > 1;
}

/** Each shard has one Vitest worker; logs stay separate and coverage is checked globally. */
export async function runLocalDemoAudit(kind, vitest, workers = localDemoWorkers()) {
    const suite = suites[kind];
    const directory = mkdtempSync(join(tmpdir(), `rank-${kind}-`));
    const summaries = [], children = new Set();
    let interrupted = false;
    const stop = signal => {
        interrupted = true;
        for (const child of children) {
            try {
                if (process.platform === 'win32') child.kill(signal);
                else process.kill(-child.pid, signal);
            } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
    };
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    console.log(`${kind}: running ${workers} local demo shards; logs: ${directory}`);
    let passed = false;
    try {
        const statuses = await Promise.all(Array.from({ length: workers }, (_, shard) => new Promise(resolve => {
            const summary = join(directory, `${shard}.json`), log = join(directory, `${shard}.log`);
            summaries.push(summary);
            const descriptor = openSync(log, 'w');
            const start = performance.now();
            const child = spawn(process.execPath, [vitest, 'run', suite.file,
                '--config', join(root, 'packages/interpreter/scripts/type-audit.config.mjs'), '--maxWorkers', '1'], {
                env: { ...process.env, [`${suite.prefix}_SHARDS`]: String(workers),
                    [`${suite.prefix}_SHARD`]: String(shard), [`${suite.prefix}_SUMMARY`]: summary },
                stdio: ['ignore', descriptor, descriptor], detached: process.platform !== 'win32',
            });
            closeSync(descriptor);
            children.add(child);
            child.on('error', error => { console.error(error); });
            child.on('close', code => {
                children.delete(child);
                console.log(`${kind} ${shard + 1}/${workers}: ${code === 0 ? 'passed' : 'failed'} in ${((performance.now() - start) / 1000).toFixed(1)}s`);
                if (code !== 0 && !interrupted) console.error(readFileSync(log, 'utf8').split('\n').slice(-120).join('\n'));
                resolve(code === 0);
            });
        })));
        if (interrupted || statuses.some(status => !status)) return false;
        const check = spawnSync(process.execPath, [join(root, 'scripts', suite.check), '--shards', String(workers), ...summaries], { encoding: 'utf8' });
        if (check.error) throw check.error;
        if (check.stdout) console.log(check.stdout.trimEnd());
        if (check.stderr) console.error(check.stderr.trimEnd());
        passed = check.status === 0;
        return passed;
    } finally {
        if (children.size) stop('SIGTERM');
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
        if (passed) rmSync(directory, { recursive: true, force: true });
        else console.error(`${kind}: audit logs retained at ${directory}`);
    }
}
