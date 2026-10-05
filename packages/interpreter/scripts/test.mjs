import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const requested = process.argv.slice(2);
// Keep the CPU-heavy demo audit alone: under Node 22, competing workers can
// delay Vitest's task-update RPC past its 60-second deadline.
const runs = requested.length ? [requested]
    : [['--exclude', 'test/types.test.ts'], ['test/types.test.ts']];

for (const args of runs) {
    const result = spawnSync(process.execPath, [vitest, 'run', ...args], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
