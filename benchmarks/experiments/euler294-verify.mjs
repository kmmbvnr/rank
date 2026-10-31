import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';

// Independent, exact digit-by-digit DP; no period or binomial identities.
let dp = Array(552).fill(0n);
dp[0] = 1n;
const expected = [0n];
for (let n = 1; n <= 100; n++) {
    const next = Array(552).fill(0n);
    for (let s = 0; s <= 23; s++) for (let r = 0; r < 23; r++) {
        for (let d = 0; d <= Math.min(9, 23 - s); d++) {
            next[23 * (s + d) + (10 * r + d) % 23] += dp[23 * s + r];
        }
    }
    dp = next;
    expected.push(dp[529]);
}
// A separate enumeration oracle for the first six decimal lengths.
for (let n = 0; n <= 6; n++) {
    let count = 0n;
    for (let k = 23; k < 10 ** n; k += 23) {
        if ([...String(k)].reduce((s, d) => s + Number(d), 0) === 23) count++;
    }
    assert.equal(expected[n], count);
}
const template = readFileSync(new URL('../../demos/euler/294_sumofdigits.ra', import.meta.url), 'utf8');
const cases = [];
for (let n = 0; n <= 100; n++) {
    const mod = [1n, 23n, 46n, 529n, 1000000000n, 1000000000000000000n][n % 6];
    for (const compilation of [true, false]) {
        const interpreter = new Interpreter(() => {}, {compilation});
        try {
            interpreter.execute(template.replace('arg N integer = 3138428376721', `arg N integer = ${n}`)
                .replace('arg Mod integer = 1000000000', `arg Mod integer = ${mod}`));
            const answer = String(interpreter.variables.get('Answer'));
            assert.equal(answer, String(expected[n] % mod), `N=${n}, Mod=${mod}, compilation=${compilation}`);
            cases.push({n, mod: String(mod), compilation, answer});
        } finally { interpreter.dispose(); }
    }
}
writeFileSync(new URL('../baselines/2026-10-31-euler294-verification.json', import.meta.url), JSON.stringify({enumerationLengths: 7, cases}, null, 2) + '\n');
console.log(`Passed ${cases.length} Rank cases and 7 independent enumeration checks`);
