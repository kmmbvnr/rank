import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter} = await import(new URL(process.env.RUNTIME || '../../packages/interpreter/out/index.js', import.meta.url));

// Independent distinct-part knapsack, maximizing exact products.
const size = 240, mod = 982451653n;
const best = Array(size + 1).fill(0n), count = Array(size + 1).fill(0n);
best[0] = 1n;
for (let part = 1; part <= size; part++) {
    for (let sum = size; sum >= part; sum--) {
        if (best[sum - part] === 0n) continue;
        const candidate = best[sum - part] * BigInt(part);
        if (candidate > best[sum]) {
            best[sum] = candidate;
            count[sum] = count[sum - part] + 1n;
        } else if (candidate === best[sum]) {
            assert.equal(count[sum], count[sum - part] + 1n);
        }
    }
}
const expected = [];
let total = 0n;
for (let n = 1; n <= size; n++) {
    total = (total + best[n] * count[n]) % mod;
    expected[n] = total;
}
let checks = 0;
const sources = new Map();
for (const name of ['original', 'inline', 'recurrence', 'production']) {
    const source = readFileSync(new URL(name === 'production' ? '../../demos/euler/374_partproduct.ra'
        : `./euler374-${name}.ra`, import.meta.url), 'utf8');
    sources.set(name, source);
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, {compilation});
        try {
            for (let n = 1; n <= size; n++) {
                const input = source.replace('arg Limit integer = 10 ** 14', `Limit = ${n}`);
                runtime.execute(input);
                assert.equal(runtime.variables.get('Answer'), expected[n], `${name}, compilation=${compilation}, limit=${n}`);
                checks++;
            }
        } finally { runtime.dispose(); }
    }
}
let boundaryChecks = 0;
const limits = new Set();
for (const m of [31, 100, 1000, 4096]) {
    const start = m * (m + 3) / 2;
    for (const offset of [-1, 0, 1, m - 1, m, m + 1, m + 2]) limits.add(start + offset);
}
for (const limit of limits) {
    let original;
    for (const [name, source] of sources) {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, {compilation});
            try {
                runtime.execute(source.replace('arg Limit integer = 10 ** 14', `Limit = ${limit}`));
                const actual = runtime.variables.get('Answer');
                if (original === undefined) original = actual;
                assert.equal(actual, original, `${name}, compilation=${compilation}, limit=${limit}`);
                boundaryChecks++;
            } finally { runtime.dispose(); }
        }
    }
}
for (const compilation of [false, true]) {
    const runtime = new Interpreter(() => {}, {compilation});
    try {
        runtime.execute(sources.get('recurrence').replace('arg Limit integer = 10 ** 14', 'Limit = 0'));
        assert.equal(runtime.variables.get('Answer'), 0n);
    } finally { runtime.dispose(); }
}
console.log(JSON.stringify({checks, oracle: 'distinct-part exact-product knapsack', maxLimit: size,
    boundaryChecks, boundaryOracle: 'original exact modular-inverse solver', zeroChecks: 2}));
