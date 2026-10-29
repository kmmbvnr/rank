// Independent ascending search over n, without factorial-base representations.
import assert from 'node:assert/strict';
const factorials = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];
const g = {};
for (let n = 1; n <= 1000000 && Object.keys(g).length < 20; n++) {
    let value = n, f = 0;
    while (value) {
        f += factorials[value % 10];
        value = Math.floor(value / 10);
    }
    let sf = 0;
    while (f) {
        sf += f % 10;
        f = Math.floor(f / 10);
    }
    if (sf >= 1 && sf <= 20 && g[sf] === undefined) g[sf] = n;
}
let total = 0;
const prefixes = { 0: 0 };
for (let i = 1; i <= 20; i++) {
    assert.notEqual(g[i], undefined);
    total += [...String(g[i])].reduce((sum, digit) => sum + Number(digit), 0);
    prefixes[i] = total;
}
assert.equal(g[5], 25);
assert.equal(g[20], 267);
assert.equal(prefixes[20], 156);
console.log(JSON.stringify({ g, prefixes }));
