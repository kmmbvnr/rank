// Derive Grundy values from legal moves, without the least-prime-factor theorem.
export function grundy(n) {
    const values = [0];
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    for (let pile = 1; pile < n; pile++) {
        const used = new Set();
        for (let take = 1; take <= pile; take++) if (gcd(take, pile) === 1) used.add(values[pile - take]);
        let value = 0; while (used.has(value)) value++;
        values.push(value);
    }
    return values;
}
export function solve(n, k, modulus = 1000000007n) {
    const piles = grundy(n).slice(1);
    let counts = new Map([[0, 1n]]);
    for (let i = 0; i < k; i++) {
        const next = new Map();
        for (const [key, count] of counts) for (const pile of piles) {
            const x = key ^ pile; next.set(x, ((next.get(x) ?? 0n) + count) % modulus);
        }
        counts = next;
    }
    return counts.get(0) ?? 0n;
}
