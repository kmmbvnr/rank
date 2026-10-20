import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canShardLocally, runLocalDemoAudit } from '../../../scripts/local-demo-audits.mjs';

const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const config = fileURLToPath(new URL('../../interpreter/scripts/type-audit.config.mjs', import.meta.url));
const requested = process.argv.slice(2);
const corpus = 'test/name-facts-corpus.test.ts';
const parallel = canShardLocally('names') && (!requested.length || requested.length === 1 && requested[0] === corpus);
if (!parallel || !requested.length) {
    const args = parallel ? ['--exclude', corpus] : requested;
    // Like interpreter tests and local shards, drain RPC reports before a
    // synchronous demo can block the worker for longer than the RPC deadline.
    const result = spawnSync(process.execPath, [vitest, 'run', ...args, '--config', config], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
if (parallel && !await runLocalDemoAudit('names', vitest)) process.exit(1);
