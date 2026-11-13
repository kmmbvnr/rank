import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, isRankArray, isRankTuple, type InterpreterOptions, type RankValue } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { answerOf } from './support.js';
const fixture = new URL('../../../demos/euler/482_incenter_test.ra', import.meta.url);
const source = readFileSync(new URL('482_incenter.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
function brute(limit: number): bigint {
    let sum = 0;
    for (let a = 1; 3 * a <= limit; a++) for (let b = a; a + 2 * b <= limit; b++) {
        const last = Math.min(a + b - 1, limit - a - b);
        for (let c = b; c <= last; c++) {
            const p = a + b + c;
            const numerators = [b * c * (p - 2 * a), a * c * (p - 2 * b), a * b * (p - 2 * c)];
            if (numerators.some(n => n % p)) continue;
            const roots = numerators.map(n => Math.floor(Math.sqrt(n / p)));
            if (roots.every((root, i) => root * root === numerators[i] / p)) sum += p + roots[0] + roots[1] + roots[2];
        }
    }
    return BigInt(sum);
}
function cells(value: RankValue | undefined): bigint[] {
    if (!value || !isRankArray(value)) throw Error('expected array');
    return Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i) as bigint);
}
function solve(p: number, options: InterpreterOptions, check?: (r: Interpreter) => void) {
    const r = new Interpreter(() => {}, { ...options, args: [`--p=${p}`] });
    try { r.execute(source); check?.(r); return answerOf(r); } finally { r.dispose(); }
}
it.each([0, 1, 11, 12, 99, 100, 200, 500, 999, 1000, 1001])('matches all integer-sided triangles through perimeter %s', p => {
    const expected = brute(p);
    for (const options of backends) expect(solve(p, options)).toBe(expected);
});
it('keeps every window within the exact radius, order and perimeter constraints', () => {
    for (const options of backends) solve(1000, options, r => {
        const triples = r.variables.get('Triples'), windows = r.variables.get('Windows');
        if (!triples || !isRankTuple(triples) || !windows || !isRankTuple(windows)) throw Error('expected tuple');
        const [radii, legs, distances] = triples.items.map(cells);
        const [query, low, counts] = windows.items.slice(0, 3).map(cells);
        const half = 500n;
        for (let i = 0; i < radii.length; i++) {
            const radius = radii[i], x = legs[i], distance = distances[i];
            expect(distance * distance).toBe(radius * radius + x * x);
            expect((radius + distance) ** 2n <= half * x).toBe(true);
            if (i) expect(radii[i - 1] < radius || radii[i - 1] === radius && legs[i - 1] <= x).toBe(true);
        }
        for (let i = 0; i < query.length; i++) {
            const first = Number(query[i]), radius = radii[first], x = legs[first], square = radius * radius;
            for (let j = Number(low[i]); j < Number(low[i] + counts[i]); j++) {
                const y = legs[j], product = x * y, divisor = product - square;
                expect(radii[j]).toBe(radius); expect(y >= x && divisor > 0n).toBe(true);
                expect(square * (x + y) >= y * divisor).toBe(true);
                expect(product * (half - x - y) >= half * square).toBe(true);
            }
        }
    });
});
it.each(backends)('retains statement and larger fixtures with options=%j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) { expect(specifier).toBe('482_incenter'); return { id: new URL('482_incenter.ra', fixture).pathname, source }; },
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true, true]); } finally { r.dispose(); }
});
it('checks the full incenter sum against the independent adjacency-list oracle', () => {
    expect(solve(10000000, {})).toBe(1400824879147n);
}, 60000);
