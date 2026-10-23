// Independent eager Number oracle. Coordinates, squares and dot products are
// exact safe integers for the Euler radii. No edge pruning or bidirectional search.
export function spherePoints(radius, reduced = false) {
    const points = [], r2 = radius * radius;
    for (let x = reduced ? 0 : -radius; x <= radius; x++) {
        const top = Math.floor(Math.sqrt(r2 - x * x));
        for (let y = reduced ? x : -top; y <= top; y++) {
            const z2 = r2 - x * x - y * y;
            const z = Math.floor(Math.sqrt(z2));
            if (z * z !== z2) continue;
            points.push([x, y, z]);
            if (z !== 0) points.push([x, y, -z]);
        }
    }
    return points;
}

export function moonOracle(radius, reduced = false) {
    const points = spherePoints(radius, reduced), count = points.length;
    const distance = new Float64Array(count).fill(Infinity), done = new Uint8Array(count);
    const start = points.findIndex(([x, y, z]) => x === 0 && y === 0 && z === radius);
    const goal = points.findIndex(([x, y, z]) => x === 0 && y === 0 && z === -radius);
    distance[start] = 0;
    const r2 = radius * radius;
    for (;;) {
        let at = -1, best = Infinity;
        for (let i = 0; i < count; i++) if (!done[i] && distance[i] < best) {
            at = i; best = distance[i];
        }
        if (at === goal) return best;
        done[at] = 1;
        const [x, y, z] = points[at];
        for (let i = 0; i < count; i++) {
            if (done[i]) continue;
            const other = points[i];
            const angle = Math.acos((x * other[0] + y * other[1] + z * other[2]) / r2) / Math.PI;
            const candidate = best + angle * angle;
            if (candidate < distance[i]) distance[i] = candidate;
        }
    }
}
