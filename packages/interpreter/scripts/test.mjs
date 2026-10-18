import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const requested = process.argv.slice(2);
// Keep CPU-heavy exhaustive audits alone: under Node 22, competing workers can
// delay Vitest's task-update RPC past its 60-second deadline.
const audits = ['test/types.test.ts', 'test/differential.test.ts', 'test/nurikabe.test.ts'];
const runs = requested.length ? [requested]
    : [audits.flatMap(file => ['--exclude', file]), ...audits.map(file => [file])];

for (const args of runs) {
    // Ordinary suites also contain long synchronous calls. Drain task reports
    // before each test so those calls cannot leave a pending RPC to time out.
    const runner = ['--config', './scripts/type-audit.config.mjs', '--maxWorkers', '4'];
    const result = spawnSync(process.execPath, [vitest, 'run', ...args, ...runner], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
