// Direct colored-interval simulation; no cut graph, cycle matching or CRT.
export function flips(a, b, c, limit = 2000000) {
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    const root = Math.floor(Math.sqrt(c)), square = root * root === c;
    let denominator = a / gcd(a, b) * b;
    if (square) denominator = denominator / gcd(denominator, root) * root;
    const sizes = [[denominator / a, 0], [denominator / b, 0], square ? [denominator / root, 0] : [0, 1]];
    const value = point => point[0] / denominator + point[1] / Math.sqrt(c);
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    let pieces = [{ low: [0, 0], high: [denominator, 0], color: false }];
    for (let step = 0; step < limit; step++) {
        const size = sizes[step % 3], boundary = value(size), suffix = [], prefix = [];
        const append = (out, low, high, color) => {
            if (same(low, high)) return;
            const previous = out.at(-1);
            if (previous?.color === color && same(previous.high, low)) previous.high = high;
            else out.push({ low, high, color });
        };
        for (const { low, high, color } of pieces) {
            const lowBelow = !same(low, size) && value(low) < boundary;
            const highAbove = !same(high, size) && value(high) > boundary;
            if (lowBelow) {
                const end = highAbove ? size : high;
                prefix.push({ low: [denominator - end[0], -end[1]], high: [denominator - low[0], -low[1]], color: !color });
            }
            if (highAbove) {
                const start = lowBelow ? size : low;
                append(suffix, [start[0] - size[0], start[1] - size[1]], [high[0] - size[0], high[1] - size[1]], color);
            }
        }
        for (let i = prefix.length - 1; i >= 0; i--) {
            const { low, high, color } = prefix[i]; append(suffix, low, high, color);
        }
        pieces = suffix;
        if (pieces.every(piece => !piece.color)) return step + 1;
    }
    throw Error(`direct flip limit exceeded for ${a},${b},${c}`);
}
export function total(n) {
    let sum = 0n;
    for (let a = 9; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c <= n; c++) sum += BigInt(flips(a, b, c));
    return sum;
}
