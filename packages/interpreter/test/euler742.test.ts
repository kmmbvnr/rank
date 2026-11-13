import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/742_convexgridpolygon.ra', import.meta.url), 'utf8');
const missing = 4000000000000000001n;

// Enumerate subsets of primitive directions, independently of the DP table.
function enumerate(vertices: number, reach: number, width: number): bigint {
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const vectors: [number, number][] = [];
    for (let x = 1; x <= reach; x++) for (let y = 1; y <= reach; y++) {
        if (gcd(x, y) === 1) vectors.push([x, y]);
    }
    vectors.sort(([x, y], [a, b]) => y * a - b * x);
    let best = Infinity;
    function visit(start: number, count: number, column: number, area: number): void {
        if (!count) { best = Math.min(best, area); return; }
        for (let i = start; i <= vectors.length - count; i++) {
            const [x, y] = vectors[i];
            if (column + x <= width) visit(i + 1, count - 1, column + x,
                area + 4 * column * y + 2 * x + 2 * y + 2 * x * y);
        }
    }
    visit(0, vertices / 4 - 1, 0, 1);
    return Number.isFinite(best) ? BigInt(best) : missing;
}
function run(vertices: number, reach: number, width: number, compilation: boolean): unknown {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(source.replace('arg Vertices integer = 1000', `Vertices = ${vertices}`)
            .replace('arg Reach integer = 40', `Reach = ${reach}`)
            .replace('arg Width integer = 2400', `Width = ${width}`));
        return answerOf(runtime);
    } finally { runtime.dispose(); }
}
for (const compilation of [false, true]) describe(`Euler 742 (compiled=${compilation})`, () => {
    it.each([[4, 1, 0], [4, 0, 0], [8, 1, 1], [8, 1, 0], [12, 1, 8],
        [12, 2, 2], [12, 2, 1], [16, 2, 4], [16, 2, 3], [20, 3, 8], [24, 3, 12], [28, 4, 16]])(
        'matches direction-subset enumeration at %i/%i/%i', (vertices, reach, width) => {
            expect(run(vertices, reach, width, compilation)).toBe(enumerate(vertices, reach, width));
        });
    it.each([[40, 10, 80, 1039n], [100, 20, 400, 17473n]])(
        'matches the published A(%i)', (vertices, reach, width, expected) => {
            expect(run(Number(vertices), Number(reach), Number(width), compilation)).toBe(expected);
        });
});
