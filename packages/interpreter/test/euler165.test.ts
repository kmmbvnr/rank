import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/165_intersections.ra', import.meta.url), 'utf8');

// Parametric intersections and separately reduced x/y fractions, independent
// of the demo's orientation tests, shared denominator and packed sort keys.
function oracle(count: number): bigint {
    let seed = 290797n;
    const points: bigint[][] = [];
    for (let i = 0; i < count; i++) {
        const segment: bigint[] = [];
        for (let j = 0; j < 4; j++) {
            seed = seed * seed % 50515093n;
            segment.push(seed % 500n);
        }
        points.push(segment);
    }
    const fraction = (n: bigint, d: bigint): string => {
        let a = n, b = d;
        while (b) [a, b] = [b, a % b];
        return `${n / a}/${d / a}`;
    };
    const distinct = new Set<string>();
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const [px, py, bx, by] = points[i], [qx, qy, sx, sy] = points[j];
        const dx = bx - px, dy = by - py, ex = sx - qx, ey = sy - qy;
        let den = dx * ey - dy * ex;
        let t = (qx - px) * ey - (qy - py) * ex;
        let u = (qx - px) * dy - (qy - py) * dx;
        if (den < 0n) { den = -den; t = -t; u = -u; }
        if (t <= 0n || t >= den || u <= 0n || u >= den) continue;
        distinct.add(`${fraction(px * den + dx * t, den)},${fraction(py * den + dy * t, den)}`);
    }
    return BigInt(distinct.size);
}

describe.each([false, true])('Euler 165 (compilation=%s)', compilation => {
    it.each([1, 2, 3, 5, 10, 30, 50, 100])('matches rational intersections for %i segments', count => {
        const r = new Interpreter(() => {}, { compilation,
            args: [`--segs=${count}`, `--room=${count * (count - 1) / 2}`] });
        try {
            r.execute(source);
            expect(r.variables.get('Answer')).toBe(oracle(count));
        } finally { r.dispose(); }
    });
});
