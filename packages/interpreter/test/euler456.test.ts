import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/456_triangleorigin.ra', import.meta.url), 'utf8');
const backends = [{}, { compilation: false }, { numberLoopCompilation: false }];
function points(count: number): [number, number][] {
    let x = 1, y = 1;
    return Array.from({ length: count }, () => { x = x * 1248 % 32323; y = y * 8421 % 30103; return [x - 16161, y - 15051]; });
}
function brute(points: [number, number][]) {
    const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];
    let answer = 0n;
    for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) for (let c = b + 1; c < points.length; c++) {
        const signs = [cross(points[a], points[b]), cross(points[b], points[c]), cross(points[c], points[a])];
        if (signs.every(s => s > 0) || signs.every(s => s < 0)) answer++;
    }
    return answer;
}
function solve(n: number, options: object, program = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(program); return runtime.variables.get('Answer'); } finally { runtime.dispose(); }
}
it.each([0, 1, 2, 3, 4, 5, 8, 12, 20, 40, 80])('matches independent strict triangle counts at N=%s', n => {
    for (const options of backends) expect(solve(n, options)).toBe(brute(points(n)));
});
it.each([
    [[1, 0], [-1, 0], [0, 1], [0, -1]],
    [[1, 0], [-1, 2], [-1, -2]],
    [[1, 0], [2, 0], [-1, 2], [-2, 4], [-1, -2]],
    [[1, 0], [2, 0], [-1, 0], [-2, 0], [0, 1], [0, -1], [1, 1], [-1, -1]],
    [[16160, 15051], [16159, 15050], [-16160, -15051], [-1, 1], [0, 0], [1, -1]],
] as [number, number][][])('handles ray weights, opposite pairs and boundary points: %j', (...given) => {
    const vector = (items: number[]) => items.length ? `array ${items.join(' ')}` : 'array shape 0 fill 0';
    const program = source.replace(/^X = .+$/m, `X = ${vector(given.map(p => p[0]))}`).replace(/^Y = .+$/m, `Y = ${vector(given.map(p => p[1]))}`);
    for (const options of backends) expect(solve(given.length, options, program)).toBe(brute(given));
});
it('retains the fixture answers on all backends', () => {
    for (const options of backends) {
        expect(solve(600, options)).toBe(8950634n);
        expect(solve(40000, options)).toBe(2666610948988n);
    }
});
it('retains the full two-million-point answer', () => {
    expect(solve(2000000, {})).toBe(333333208685971546n);
}, 60000);
