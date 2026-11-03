import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';
// @ts-expect-error The independent benchmark oracle is intentionally plain JavaScript.
import { moonOracle, spherePoints } from '../../../benchmarks/lib/euler353-oracle.mjs';

const fullSource = readFileSync(new URL('../../../demos/euler/353_riskymoon.ra', import.meta.url), 'utf8');
const source = fullSource.split('Sum = 0.0')[0];

describe('Euler 353 reduced geometric search', () => {
    it('generates exactly the full sphere orbits, including zero and equal coordinates', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source);
            for (let radius = 0; radius <= 64; radius++) {
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
    it('matches the independent coordinate scan at every default radius in both engines', () => {
        const expected = Array.from({ length: 15 }, (_, i) => {
            const radius = 2 ** (i + 1) - 1, base = BigInt(radius + 1), r = BigInt(radius);
            const codes = spherePoints(radius, true).map(([x, y, z]: number[]) =>
                (BigInt(z) + r) * base * base + BigInt(x) * base + BigInt(y));
            codes.sort((a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0);
            return { radius, codes };
        });
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(source);
                for (const { radius, codes } of expected) {
                    const actual = runtime.execute(`${radius} moonpoints`);
                    if (!actual || !isRankArray(actual)) throw Error('expected point codes');
                    expect(actual.items).toEqual(codes);
                }
            } finally { runtime.dispose(); }
        }
    }, 60_000);

    it('preserves the full golden and keeps geometric search in a Number kernel', () => {
        const kernels: string[] = [];
        const runtime = new Interpreter(() => {}, { onIntegerLoopCompiled: source => kernels.push(source) });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(fullSource));
            expect(runtime.variables.get('Answer')).toBe(1.2759860331);
            expect(kernels.some(source => source.includes('input, cells, changes') && source.includes('Math.acos'))).toBe(true);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.fallbacks['loop:unstable-bindings:ForStatement']).toBeUndefined();
        } finally { runtime.dispose(); }
    }, 90_000);

});
