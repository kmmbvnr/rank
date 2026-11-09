// Enumerate empty lattice triangles directly. No long-edge lens or Bezout search.
function isqrt(n) {
    if (n < 2n) return n;
    let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
    for (;;) { const y = (x + n / x) / 2n; if (y >= x) return x; x = y; }
}
const rootCache = new Map();
function interval(sides, bits) {
    let sum = 0n;
    for (const side of sides) {
        const key = `${side}/${bits}`;
        let root = rootCache.get(key);
        if (root === undefined) { root = isqrt(BigInt(side) << BigInt(2 * bits)); rootCache.set(key, root); }
        sum += root;
    }
    return sum;
}
function radicalKey(sides) {
    const coefficients = new Map();
    for (let n of sides) {
        let coefficient = 1, radical = 1;
        for (let p = 2; p * p <= n; p++) {
            let e = 0; while (n % p === 0) { n /= p; e++; }
            coefficient *= p ** Math.floor(e / 2);
            if (e % 2) radical *= p;
        }
        radical *= n;
        coefficients.set(radical, (coefficients.get(radical) ?? 0) + coefficient);
    }
    return [...coefficients].sort((a, b) => a[0] - b[0]).map(pair => pair.join(':')).join(',');
}
function compare(a, b) {
    if (radicalKey(a) === radicalKey(b)) return 0;
    for (let bits = 64; bits <= 1024; bits *= 2) {
        const delta = interval(a, bits) - interval(b, bits);
        if (delta >= 3n) return 1;
        if (delta <= -3n) return -1;
    }
    throw Error('unseparated radical intervals');
}
export function solve(r) {
    const points = [];
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++)
        if (x * x + y * y <= r * r) points.push([x, y]);
    let best, perimeter = -1n;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j], x = b[0] - a[0], y = b[1] - a[1];
        for (let k = j + 1; k < points.length; k++) {
            const c = points[k], u = c[0] - a[0], v = c[1] - a[1];
            if (Math.abs(x * v - y * u) !== 1) continue;
            const sides = [x * x + y * y, u * u + v * v, (u - x) ** 2 + (v - y) ** 2].sort((a, b) => a - b);
            const bound = interval(sides, 64);
            if (bound + 3n < perimeter) continue;
            if (!best || compare(sides, best) > 0) { best = sides; perimeter = bound; }
        }
    }
    if (!best) throw Error('no empty triangle');
    const numerator = best.reduce((product, value) => product * BigInt(value), 1n), denominator = 4n * BigInt(r * r);
    const floor = isqrt(numerator / denominator), midpoint = 2n * floor + 1n;
    return { answer: floor + BigInt(midpoint * midpoint * denominator <= 4n * numerator), sides: best, numerator, denominator };
}
