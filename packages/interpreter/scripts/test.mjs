import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const requested = process.argv.slice(2);
// Keep the CPU-heavy demo audit alone: under Node 22, competing workers can
// delay Vitest's task-update RPC past its 60-second deadline.
const runs = requested.length ? [requested]
    : [['--exclude', 'test/types.test.ts', '--exclude', 'test/differential.test.ts'],
        ['test/types.test.ts'], ['test/differential.test.ts']];

for (const args of runs) {
    const runner = args.some(arg => ['test/types.test.ts', 'test/differential.test.ts'].includes(arg)) && !args.includes('--exclude')
        ? ['--config', './scripts/type-audit.config.mjs'] : [];
    const result = spawnSync(process.execPath, [vitest, 'run', ...args, ...runner], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
