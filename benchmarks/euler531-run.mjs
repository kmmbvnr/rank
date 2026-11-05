// Paired fresh-process samples; arguments are label=/absolute/built/checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const roots = process.argv.slice(2).map(value => {
    const split = value.indexOf('=');
    assert.ok(split > 0, 'expected label=checkout');
    return [value.slice(0, split), resolve(value.slice(split + 1))];
});
assert.ok(roots.length);
for (let sample = 0; sample < 3; sample++) for (const [step, root] of roots) {
    for (const test of (process.env.RANK_CASES ?? 'full,small,empty,sparse,dense').split(',')) {
        const command = test === 'full'
            ? [resolve(import.meta.dirname, 'euler705-investigation.mjs'), '100000000']
            : test.startsWith('prime-')
                ? [resolve(import.meta.dirname, 'euler531-primes.mjs'), test.slice(6)]
                : [resolve(import.meta.dirname, 'euler531-masks.mjs'), test];
        const run = spawnSync(process.execPath, command, {
            env: { ...process.env, RANK_ROOT: root }, encoding: 'utf8', maxBuffer: 1024 * 1024,
        });
        assert.equal(run.status, 0, run.stderr);
        const result = JSON.parse(run.stdout.trim().split('\n').at(-1));
        console.log(JSON.stringify({ ...result, step, sample, case: test }));
    }
}
