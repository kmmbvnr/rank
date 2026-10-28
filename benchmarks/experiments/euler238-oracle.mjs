// Independent word-array implementation; no Rank runtime or giant bit integers.
import assert from 'node:assert/strict';

const modulus = 20300713, start = 14025256;
let current = start, digitSum = 0, period = 0, index = 0;
const heads = [{ sum: 0, index: 0 }];
do {
    for (const character of String(current)) {
        const digit = Number(character);
        digitSum += digit;
        index++;
        if (heads.length < 100 && digit) heads.push({ sum: digitSum, index });
    }
    current = current * current % modulus;
    period++;
} while (current !== start);

const size = Math.ceil(digitSum / 32);
const bits = new Uint32Array(size), left = new Uint32Array(size).fill(0xffffffff);
bits[0] = 1;
let prefix = 0;
current = start;
do {
    for (const character of String(current)) {
        prefix += Number(character);
        if (prefix < digitSum) bits[prefix >>> 5] |= 1 << (prefix & 31);
    }
    current = current * current % modulus;
} while (current !== start);
const tail = digitSum % 32;
if (tail) left[size - 1] = 0xffffffff >>> (32 - tail);

function popcount(value) {
    value -= (value >>> 1) & 0x55555555;
    value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
    return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
// Read 32 consecutive bits, wrapping at the actual digit-sum boundary.
function read(position) {
    const length = Math.min(32, digitSum - position), word = position >>> 5, shift = position & 31;
    let value = bits[word] >>> shift;
    if (shift && word + 1 < size) value |= bits[word + 1] << (32 - shift);
    if (length < 32) value = (value & (0xffffffff >>> (32 - length))) | (bits[0] << length);
    return value;
}
const tops = [1, 2, 10, 100, 1000, digitSum - 1, digitSum, digitSum + 1, 2000000000000000];
const remainders = tops.map(top => top % digitSum), parts = tops.map(() => 0);
let weight = 0, remaining = digitSum, last;
for (const head of heads) {
    let count = 0;
    const cuts = tops.map(() => 0);
    for (let word = 0; word < size; word++) {
        const hit = (read((word * 32 + head.sum) % digitSum) & left[word]) >>> 0;
        if (!hit) continue;
        const countHere = popcount(hit);
        count += countHere;
        left[word] ^= hit;
        for (let t = 0; t < tops.length; t++) {
            const length = remainders[t] + 1 - word * 32;
            if (length >= 32) cuts[t] += countHere;
            else if (length > 0) cuts[t] += popcount(hit & (0xffffffff >>> (32 - length)));
        }
    }
    remaining -= count;
    weight += count * (1 + head.index);
    for (let t = 0; t < tops.length; t++) parts[t] += cuts[t] * (1 + head.index);
    last = head;
    if (!remaining) break;
}
assert.equal(remaining, 0, 'the enumerated starts must cover every residue');
const answers = tops.map((top, t) => ({ top,
    answer: String((BigInt(top) / BigInt(digitSum)) * BigInt(weight) + BigInt(parts[t]) - 1n) }));
assert.equal(answers.find(x => x.top === 1000).answer, '4742');
assert.equal(answers.at(-1).answer, '9922545104535661');

// A second, direct substring oracle checks the small case independently of periodicity.
let text = '', sum = 0;
current = start;
while (sum < 2200) {
    const digits = String(current);
    text += digits;
    for (const character of digits) sum += Number(character);
    current = current * current % modulus;
}
const first = new Array(1001).fill(0);
let missing = 1000;
for (let a = 0; a < text.length && missing; a++) {
    let total = 0;
    for (let b = a; b < text.length; b++) {
        total += Number(text[b]);
        if (total > 1000) break;
        if (total && !first[total]) { first[total] = a + 1; missing--; }
    }
}
assert.equal(missing, 0);
assert.equal(first.reduce((a, b) => a + b, 0), 4742);
console.log(JSON.stringify({ period, digits: index, digitSum, weight, last, answers,
    brute: { sum: 4742, maxStart: Math.max(...first), first: first.slice(1, 11) } }));
