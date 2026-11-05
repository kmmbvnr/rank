import { multiply, safeIntegerModularPower } from '../../packages/interpreter/out/runtime/modular-power.js';
const N = Number(process.argv[2] ?? 10000000), P = 1000000007, start = performance.now();
const factorial = new Int32Array(2 * N + 1), inverse = new Int32Array(2 * N + 1);
factorial[0] = 1;
for (let i = 1; i <= 2 * N; i++) factorial[i] = multiply(factorial[i - 1], i, P);
inverse[2 * N] = safeIntegerModularPower(factorial[2 * N], P - 2, P);
for (let i = 2 * N; i >= 1; i--) inverse[i - 1] = multiply(inverse[i], i, P);
const root = Math.floor(Math.sqrt(N)), keys = [], base = N + 1;
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
for (let m = 2; m * m <= 2 * root; m++) for (let n = 1; n < m; n++) {
    if ((m - n) % 2 === 0 || gcd(m, n) !== 1) continue;
    const a = m * m - n * n, b = 2 * m * n;
    for (let k = 1; k * Math.max(a, b) <= root; k++) {
        const x = a * a * k * k, y = b * b * k * k;
        keys.push(x * base + y, y * base + x);
    }
}
keys.sort((a, b) => a - b);
const X = keys.map(key => Math.floor(key / base)), Y = keys.map(key => key % base), first = new Int32Array(keys.length);
const choose = (x, y) => multiply(multiply(factorial[x + y], inverse[x], P), inverse[y], P);
let answer = choose(N, N);
for (let i = 0; i < X.length; i++) {
    let total = choose(X[i], Y[i]);
    for (let j = 0; j < i; j++) if (Y[j] <= Y[i]) {
        total -= multiply(choose(X[i] - X[j], Y[i] - Y[j]), first[j], P);
    }
    first[i] = (total % P + P) % P;
    answer -= multiply(choose(N - X[i], N - Y[i]), first[i], P);
}
answer = (answer % P + P) % P;
console.log(JSON.stringify({ N, points: keys.length, answer, ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024 }));
