// Inclusion-exclusion over forced column ascents, without reciprocal series.
export function solve(n, modulus = 1000000123n) {
    const factorial = [1n];
    for (let i = 1; i <= n; i++) factorial.push(factorial[i - 1] * BigInt(i));
    let total = 0n;
    for (let k = 1; k <= n; k++) {
        const boundaries = Math.floor((n - 1) / k);
        for (let mask = 0; mask < 2 ** boundaries; mask++) {
            let previous = 0, denominator = 1n, parity = 0;
            for (let j = 1; j <= boundaries; j++) {
                if (mask & (2 ** (j - 1))) { parity++; continue; }
                denominator *= factorial[j * k - previous];
                previous = j * k;
            }
            denominator *= factorial[n - previous];
            const rows = factorial[n] / denominator;
            total += (parity % 2 ? -1n : 1n) * rows ** BigInt(n);
        }
    }
    return (total % modulus + modulus) % modulus;
}
