// Independent scalar CRT comparison: full totient sieve and extended Euclid
// on (n,m), without the Rank program's small-gap inverse or vector pipeline.
const [low = 1000000, high = 1005000] = process.argv.slice(2).map(Number);
if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < 1 || high < low
    || !Number.isSafeInteger((high - 1) ** 2)) throw Error('Expected a positive interval with exact Number-sized CRT products');
const start = performance.now(), cpu = process.cpuUsage();
const phi = Int32Array.from({ length: high }, (_, i) => i);
for (let prime = 2; prime < high; prime++) if (phi[prime] === prime) {
    for (let multiple = prime; multiple < high; multiple += prime) phi[multiple] -= phi[multiple] / prime;
}
function crt(a, n, b, m) {
    let r = n, next = m, coefficient = 1, nextCoefficient = 0;
    while (next) {
        const quotient = Math.floor(r / next);
        [r, next] = [next, r - quotient * next];
        [coefficient, nextCoefficient] = [nextCoefficient, coefficient - quotient * nextCoefficient];
    }
    if ((b - a) % r) return 0;
    const modulus = m / r, raw = (b - a) / r * coefficient;
    const multiplier = (raw % modulus + modulus) % modulus;
    return a + n * multiplier;
}
let total = 0n, partial = 0;
for (let n = low; n < high; n++) for (let m = n + 1; m < high; m++) {
    const value = crt(phi[n], n, phi[m], m);
    if (partial > 4503599627370496 - value) { total += BigInt(partial); partial = 0; }
    partial += value;
}
total += BigInt(partial);
console.log(JSON.stringify({ low, high, node: process.version, arch: process.arch,
    ms: performance.now() - start, cpu: process.cpuUsage(cpu), rssMiB: process.resourceUsage().maxRSS / 1024,
    answer: String(total) }));
