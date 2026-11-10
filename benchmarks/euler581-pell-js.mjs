// Handwritten exact arithmetic control for the Rank Pell search.
const primes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];
function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
}
function sqrt(n) {
    let value = BigInt(Math.floor(Math.sqrt(Number(n))));
    while (value * value > n) value--;
    while ((value + 1n) ** 2n <= n) value++;
    return value;
}
const start = performance.now();
const bound = BigInt(process.argv[2] ?? '10000000000000');
const maximum = 4n * (bound > 0n ? bound : 0n) + 1n;
let parts = [1n], product = 1n;
for (const prime of primes) {
    parts = parts.concat(parts.map(value => value * prime));
    product *= prime;
}
const allowed = product ** BigInt(maximum.toString(2).length);
let answer = 0n, solved = 0, candidates = 0, iterations = 0;
for (const part of parts.slice(1)) {
    const root = sqrt(part);
    let offset = 0n, scale = 1n, term = root;
    let x = root, previousX = 1n, y = 1n, previousY = 0n;
    while (x <= maximum && x * x - part * y * y !== 1n) {
        offset = scale * term - offset;
        scale = (part - offset * offset) / scale;
        term = (root + offset) / scale;
        [x, previousX] = [term * x + previousX, x];
        [y, previousY] = [term * y + previousY, y];
        iterations++;
    }
    if (x > maximum) continue;
    solved++;
    const baseX = x, baseY = y;
    while (x <= maximum) {
        if (x % 2n === 1n) {
            candidates++;
            if (gcd(y, allowed) === y) answer += (x - 1n) / 2n;
        }
        [x, y] = [baseX * x + part * baseY * y, baseY * x + baseX * y];
    }
}
if (process.env.RANK581_EXPECTED && String(answer) !== process.env.RANK581_EXPECTED) throw Error(`Wrong answer: ${answer}`);
console.log(JSON.stringify({ mode: 'handwritten-js', n: String(bound), answer: String(answer),
    node: process.version, arch: process.arch, ms: performance.now() - start,
    solved, candidates, iterations, rssMiB: process.resourceUsage().maxRSS / 1024 }));
