import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Large synchronous searches need a process deadline. Use the built runtime
// so VM-module instrumentation cannot dominate billions of scalar operations.
const root = fileURLToPath(new URL('../../../', import.meta.url));
for (const [id, answer] of [
    ['501', '197912312715'],
    ['502', '749485217'],
    ['504', '694687'],
    ['505', '714591308667615832'],
    ['507', '316558047002627270'],
    ['511', '935247012'],
    ['513', '2925619196'],
] as const) {
    const timeout = id === '505' ? 360_000 : 120_000;
    it(`checks the complete Euler ${id} answer`, () => {
        const run = spawnSync(process.execPath, ['benchmarks/euler505-investigation.mjs', id, 'full', 'compiled'],
            { cwd: root, encoding: 'utf8', timeout, env: { ...process.env, CONTROL: '', PROFILE: '', DIAGNOSTICS: '', LC: '' } });
        expect(run.error, run.stderr).toBeUndefined();
        expect(run.status, run.stderr).toBe(0);
        expect(JSON.parse(run.stdout).answer).toBe(answer);
    }, timeout + 10_000);
}
