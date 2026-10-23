import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
// @ts-expect-error The independent benchmark oracle is intentionally plain JavaScript.
import { moonOracle, spherePoints } from '../../../benchmarks/lib/euler353-oracle.mjs';

const source = readFileSync(new URL('../../../demos/euler/353_riskymoon.ra', import.meta.url), 'utf8').split('Sum = 0.0')[0];

describe('Euler 353 reduced geometric search', () => {
    it('generates exactly the full sphere orbits, including zero and equal coordinates', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source);
            for (let radius = 1; radius <= 31; radius++) {
                runtime.execute(`Points = ${radius} moonpoints`);
                const points = runtime.variables.get('Points');
                expect(points !== undefined && isRankArray(points)).toBe(true);
                if (points === undefined || !isRankArray(points)) throw new Error('expected point codes');
                const base = BigInt(radius + 1), r = BigInt(radius);
                const expected = new Set<bigint>(spherePoints(radius).map(([x, y, z]: number[]) => {
                    const lo = BigInt(Math.min(Math.abs(x), Math.abs(y)));
                    const hi = BigInt(Math.max(Math.abs(x), Math.abs(y)));
                    return (BigInt(z) + r) * base * base + lo * base + hi;
                }));
                expect(points.items).toEqual([...expected].sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
            }
        } finally { runtime.dispose(); }
    });

    it('matches unpruned full-sphere Dijkstra for small radii', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source);
            for (const radius of [1, 2, 3, 4, 5, 6, 7, 10, 15, 31, 63, 127]) {
                runtime.execute(`Risk = ${radius} moon`);
                expect(runtime.variables.get('Risk')).toBeCloseTo(moonOracle(radius), 14);
            }
        } finally { runtime.dispose(); }
    });

    it('retains the M(7) oracle when compilation is disabled', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        try {
            runtime.execute(source + '\nRisk = 7 moon');
            expect(runtime.variables.get('Risk')).toBeCloseTo(0.17849439975514858, 14);
        } finally { runtime.dispose(); }
    });
});
