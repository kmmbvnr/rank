import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report')) {
    console.error('Usage: npm run test:capabilities -- [--report report.json]');
    process.exit(1);
}
const destination = args.length ? resolve(args[1]) : undefined;
const temporary = mkdtempSync(join(tmpdir(), 'rank-capabilities-'));
try {
    const report = join(temporary, 'report.json');
    const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
    const result = spawnSync(process.execPath, [vitest, 'run', '--config', './scripts/type-audit.config.mjs',
        '--maxWorkers', '4', 'test/capability-matrix.test.ts'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit',
        env: { ...process.env, CI: 'true', RANK_CAPABILITY_REPORT: report },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    else {
        const data = JSON.parse(readFileSync(report, 'utf8'));
        const exercised = data.inventory.ast.filter(entry => entry.cases.length).length;
        console.log(`${Object.keys(data.cases).length} verified cases; ${exercised}/${data.inventory.ast.length} AST catalogue entries exercised.`);
        console.log('Unexercised catalogue entries are gaps in this matrix, not unsupported language constructs.');
        if (destination) {
            writeFileSync(destination, JSON.stringify(data, null, 2) + '\n');
            console.log(`Verified capability report: ${destination}`);
        }
    }
} finally { rmSync(temporary, { recursive: true, force: true }); }
