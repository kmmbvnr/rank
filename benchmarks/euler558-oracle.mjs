// Independent polynomial arithmetic with certified rational root intervals.
import { pathToFileURL } from 'node:url';
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const add = (a, b) => a.map((value, i) => value + b[i]);
const zero = value => value.every(cell => cell === 0n);
const positive = [[1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]];
for (let i = 3; i <= 160; i++) positive.push(add(positive[i - 1], positive[i - 3]));
const negative = [], state = positive.slice(0, 3);
for (let i = 0; i < 400; i++) {
    const next = subtract(state[2], state[1]);
    negative.push(next); state.splice(0, 3, next, state[0], state[1]);
}
const powers = [...negative.reverse(), ...positive];
let scale, low, high;
function prepare(bits) {
    scale = 1n << BigInt(bits); low = scale; high = 2n * scale;
    while (high - low > 1n) {
        const middle = (low + high) / 2n;
        if (middle ** 3n > middle * middle * scale + scale ** 3n) high = middle;
        else low = middle;
    }
}
prepare(256);
function sign([a, b, c]) {
    if (a === 0n && b === 0n && c === 0n) return 0;
    for (;;) {
        const base = a * scale * scale;
        const lower = base + b * (b >= 0n ? low : high) * scale + c * (c >= 0n ? low * low : high * high);
        const upper = base + b * (b >= 0n ? high : low) * scale + c * (c >= 0n ? high * high : low * low);
        if (lower > 0n) return 1;
        if (upper < 0n) return -1;
        prepare(scale.toString(2).length * 2);
    }
}
export function weight(n, details = false) {
    n = BigInt(n);
    if (n < 0n) throw Error('expected a nonnegative integer');
    let rest = [n, 0n, 0n], end = powers.length;
    const selected = [];
    while (!zero(rest)) {
        let low = 0, high = end;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (sign(subtract(rest, powers[middle])) >= 0) low = middle + 1;
            else high = middle;
        }
        const index = low - 1;
        if (index < 0) throw Error('oracle exponent window exhausted');
        rest = subtract(rest, powers[index]);
        selected.push(index - negative.length); end = index;
    }
    if (selected.some((value, i) => i && selected[i - 1] - value < 3)) throw Error('invalid spacing');
    return details ? selected : selected.length;
}
export function solve(m) {
    if (!Number.isSafeInteger(m) || m < 0) throw Error('expected a nonnegative safe bound');
    let answer = 0n;
    for (let j = 1; j <= m; j++) answer += BigInt(weight(BigInt(j) ** 2n));
    return answer;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const m = Number(process.argv[2] ?? 1000), start = performance.now();
    console.log(JSON.stringify({ m, answer: String(solve(m)), ms: performance.now() - start }));
}
