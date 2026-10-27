import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/177_quadrilaterals.ra', import.meta.url), 'utf8');

// Enumerate every closing angle tuple directly, then canonicalize its eight
// rotations/reflections. No rounded keys, sorted join, or Burnside fixed counts.
function oracle(total: number): bigint {
    const sin = (angle: number) => Math.sin(angle * Math.PI / total);
    const figures = new Set<string>();
    for (let u = 2; u < total - 1; u++) {
        const v = total - u;
        for (let p = 1; p < u; p++) for (let r = 1; r < v; r++) {
            const left = sin(p) * sin(r) / (sin(u - p) * sin(v - r));
            for (let a = 1; a < v; a++) for (let c = 1; c < u; c++) {
                const right = sin(u - c) * sin(a) / (sin(c) * sin(v - a));
                if (Math.abs(Math.log(left / right)) > 1e-10) continue;
                const angles = [a, p, u - p, r, v - r, c, u - c, v - a];
                const keys: string[] = [];
                for (let turn = 0; turn < 8; turn += 2) {
                    keys.push(angles.map((_, at) => angles[(at + turn) % 8]).join(','));
                    keys.push(angles.map((_, at) => angles[7 - (at + turn) % 8]).join(','));
                }
                figures.add(keys.sort()[0]);
            }
        }
    }
    return BigInt(figures.size);
}

describe.each([false, true])('Euler 177 (compilation=%s)', compilation => {
    it.each([6, 12, 18, 24])('matches a direct angle-tuple oracle for pi/%s', total => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const scaled = source.replace(/\b(180|179|178|177)\b/g, value => String(total - (180 - Number(value))));
            runtime.execute(scaled);
            const expected = oracle(total);
            expect(expected).toBeGreaterThan(0n);
            expect(runtime.variables.get('Answer')).toBe(expected);
            expect((runtime.variables.get('Fixed') as bigint) % 8n).toBe(0n);
        } finally { runtime.dispose(); }
    });
});
