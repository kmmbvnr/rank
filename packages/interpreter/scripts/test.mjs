import { canShardLocally, runLocalDemoAudit } from '../../../scripts/local-demo-audits.mjs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const requested = process.argv.slice(2);
// Keep exhaustive audits separate from ordinary suites. Local runs schedule
// shards in separate processes; CI supplies its existing shard settings.
const audits = ['test/types.test.ts', 'test/differential.test.ts', 'test/nurikabe.test.ts'];
const runs = requested.length ? [requested]
    : [audits.flatMap(file => ['--exclude', file]), ...audits.map(file => [file])];

for (const args of runs) {
    const kind = args[0] === audits[0] ? 'types' : args[0] === audits[1] ? 'differential' : undefined;
    if (args.length === 1 && kind && canShardLocally(kind)) {
        if (!await runLocalDemoAudit(kind, vitest)) process.exit(1);
        continue;
    }
    // Ordinary suites also contain long synchronous calls. Drain task reports
    // before each test so those calls cannot leave a pending RPC to time out.
    const runner = ['--config', './scripts/type-audit.config.mjs', '--maxWorkers', '4'];
    const result = spawnSync(process.execPath, [vitest, 'run', ...args, ...runner], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
