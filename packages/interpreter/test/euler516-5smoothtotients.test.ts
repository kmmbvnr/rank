import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
// @ts-expect-error Independent benchmark oracle.
import { sieveSum } from '../../../benchmarks/euler516-oracle.mjs';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/516_5smoothtotients.ra', import.meta.url), 'utf8');
for (const compilation of [false, true]) {
    it(`matches an independent totient sieve (${compilation})`, () => {
        for (const limit of [0, 1, 2, 5, 6, 7, 10, 100, 1000, 10000, 100000]) {
            const runtime = new Interpreter(() => {}, { compilation, args: [`--l=${limit}`] });
            try {
                runtime.execute(source);
                expect(answerOf(runtime), `L=${limit}`).toBe(sieveSum(limit));
            } finally { runtime.dispose(); }
        }
    });

    it(`retains the full default answer (${compilation})`, () => {
        const run = spawnSync(process.execPath,
            ['benchmarks/euler516-investigation.mjs', '1000000000000', compilation ? 'compiled' : 'reference', 'final'],
            { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 15_000,
                env: { ...process.env, PROFILE: '', DIAGNOSTICS: '', CONTROL: '' } });
        expect(run.error, run.stderr).toBeUndefined();
        expect(run.status, run.stderr).toBe(0);
        expect(JSON.parse(run.stdout).Answer).toBe('939087315');
    }, 20_000);
}
