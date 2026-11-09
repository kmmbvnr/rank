// Independent scalar reconstruction, using explicit prime powers and their
// Carmichael values. This checks one candidate, not the global maximization.
const t = Number(process.argv[2]);
if (!Number.isSafeInteger(t) || t < 1) throw Error('Pass a positive safe integer t');
const prime = n => { for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return n >= 2; };
const divisors = [];
for (let d = 1; d * d <= t; d++) if (t % d === 0) { divisors.push(d); if (d * d !== t) divisors.push(t / d); }
const gcd = (a, b) => b ? gcd(b, a % b) : a;
let maximal = 1n, lambda = 1n;
for (const divisor of divisors) {
    const p = divisor + 1;
    if (!prime(p)) continue;
    let rest = t, valuation = 0;
    while (rest % p === 0) { rest /= p; valuation++; }
    const exponent = p === 2 ? t % 2 ? 1 : valuation + 2 : valuation + 1;
    const power = BigInt(p) ** BigInt(exponent);
    const component = p === 2 && exponent >= 3 ? power / 4n : power / BigInt(p) * BigInt(p - 1);
    if (BigInt(t) % component !== 0n) throw Error('Invalid prime-power Carmichael component');
    maximal *= power;
    lambda = lambda / gcd(lambda, component) * component;
}
console.log(JSON.stringify({ t, maximal: String(maximal), digits: String(maximal).length,
    lambda: String(lambda), answer: String((maximal + 1n) % 1000000000n) }));
