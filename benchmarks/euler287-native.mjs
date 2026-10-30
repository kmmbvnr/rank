import assert from 'node:assert/strict';

// Number-only control for the original traversal, not an implementation of
// Rank's arbitrary-precision arithmetic or error contracts. At N <= 24 all
// squared distances, indices and the final total are safe integers.
const n = Number(process.argv[2] ?? 24);
assert(Number.isInteger(n) && n >= 1 && n <= 24);
const start = performance.now();
const center = 2 ** (n - 1), radiusSquared = center * center;
const cap = 4 * n + 8;
const xs = new Int32Array(cap), ys = new Int32Array(cap), sizes = new Int32Array(cap);
sizes[0] = 2 * center;
let top = 1, bits = 0;
while (top > 0) {
    top--;
    const x0 = xs[top], y0 = ys[top], side = sizes[top];
    const x1 = x0 + side - 1, y1 = y0 + side - 1;
    const fx = (x0 - center) * (x0 - center), gx = (x1 - center) * (x1 - center);
    let far = fx;
    if (gx > far) far = gx;
    const fy = (y0 - center) * (y0 - center), gy = (y1 - center) * (y1 - center);
    let farY = fy;
    if (gy > farY) farY = gy;
    let nx = center, ny = center;
    if (center < x0) nx = x0;
    if (center > x1) nx = x1;
    if (center < y0) ny = y0;
    if (center > y1) ny = y1;
    const dx = nx - center, dy = ny - center;
    if (far + farY <= radiusSquared || dx * dx + dy * dy > radiusSquared) bits += 2;
    else {
        bits++;
        const half = Math.trunc(side / 2);
        xs[top] = x0; ys[top] = y0; sizes[top] = half;
        xs[top + 1] = x0 + half; ys[top + 1] = y0; sizes[top + 1] = half;
        xs[top + 2] = x0; ys[top + 2] = y0 + half; sizes[top + 2] = half;
        xs[top + 3] = x0 + half; ys[top + 3] = y0 + half; sizes[top + 3] = half;
        top += 4;
    }
}
if (n === 24) assert.equal(bits, 313135496);
console.log(JSON.stringify({mode: 'native-number', variant: 'original', n,
    answer: String(bits), ms: performance.now() - start,
    rssMiB: process.resourceUsage().maxRSS / 1024}));
