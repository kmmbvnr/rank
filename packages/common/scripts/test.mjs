import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { canShardLocally, runLocalDemoAudit } from '../../../scripts/local-demo-audits.mjs';

const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const requested = process.argv.slice(2);
const corpus = 'test/name-facts-corpus.test.ts';
const parallel = canShardLocally('names') && (!requested.length || requested.length === 1 && requested[0] === corpus);
if (!parallel || !requested.length) {
    const args = parallel ? ['--exclude', corpus] : requested;
    const result = spawnSync(process.execPath, [vitest, 'run', ...args], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
if (parallel && !await runLocalDemoAudit('names', vitest)) process.exit(1);
