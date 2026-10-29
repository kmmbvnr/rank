// Direct side enumeration, independent of the Rank parameterization.
// All side products are below 10^6 and are exact Numbers.
const limit = 1000, counts = new Uint32Array(limit + 1);
let triangles = 0;
for (let a = 1; a <= Math.floor(limit / 3); a++) {
    for (let b = a; b <= Math.floor((limit - a) / 2); b++) {
        const high = Math.min(a + b - 1, limit - a - b);
        for (let c = b; c <= high; c++) {
            triangles++;
            if (((a + b) * (a + c)) % (b * c) === 0) counts[a + b + c]++;
        }
    }
}
for (let p = 1; p <= limit; p++) counts[p] += counts[p - 1];
console.log(JSON.stringify({ limit, triangles, counts: Array.from(counts) }));
