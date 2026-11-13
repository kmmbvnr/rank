import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter} = await import(process.env.RANK_BENCH_RUNTIME
    || new URL('../../packages/interpreter/out/index.js', import.meta.url).href);

// Independent counts from prime factorization, without enumerating square pairs.
function oracle(limit) {
    let answer = 0;
    for (let n = 1; n <= Math.floor(limit / 4); n++) {
        let value = n, divisors = 1, valid = true;
        for (let p = 2; p * p <= value; p++) {
            let exponent = 0;
            while (value % p === 0) { exponent++; value /= p; }
            if (p % 4 === 1) divisors *= exponent + 1;
            if (p % 4 === 3 && exponent % 2) valid = false;
        }
        if (value > 1 && value % 4 === 1) divisors *= 2;
        if (value % 4 === 3) valid = false;
        const square = Number.isInteger(Math.sqrt(n));
        const diagonal = Number.isInteger(Math.sqrt(n / 2));
        const r = valid ? (divisors - Number(square) - Number(diagonal)) / 2 : 0;
        answer += r * (r - 1) * (r - 2) / 6 + Number(diagonal) * r * (r - 1) / 2;
    }
    return answer;
}
let checks = 0;
for (const file of ['../../demos/euler/311_biclinic.ra', './euler311-online.ra']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const limit of [0, 1, 4, 20, 100, 999, 1250, 9999, 10000, 10001]) {
        const expected = oracle(limit);
        for (const block of [7, 97, 4000]) for (const mode of ['compiled', 'reference']) {
            const interpreter = new Interpreter(() => {}, {compilation: mode === 'compiled'});
            try {
                interpreter.execute(source
                    .replace('arg Limit integer = 10 ** 10', `arg Limit integer = ${limit}`)
                    .replace(/arg Block integer = \d+/, `arg Block integer = ${block}`));
                assert.equal(String((interpreter.variables.get('Answer') ?? interpreter.lastResult)), String(expected),
                    `${file}/${limit}/${block}/${mode}`);
                checks++;
            } finally { interpreter.dispose(); }
        }
    }
}
assert.equal(oracle(10000), 49);
assert.equal(oracle(1000000), 38239);
console.log(JSON.stringify({checks,
    oracle: 'prime-factorization sum-of-two-squares counts, square and twice-square corrections',
    million: 38239}));
