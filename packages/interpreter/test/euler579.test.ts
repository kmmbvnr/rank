import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/579_latticecubes.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler579-original.ra', import.meta.url), 'utf8');
type Vector = [number, number, number];
const dot = (a: Vector, b: Vector) => a.reduce((sum, value, i) => sum + value * b[i], 0);
// Enumerate edge frames, canonicalize all eight vertices and count grid points.
// No quaternion, orbit weight or Ehrhart polynomial enters this geometry oracle.
function direct(bound: number) {
    const vectors: Vector[] = [], cubes = new Set<string>();
    let answer = 0;
    for (let x = -bound; x <= bound; x++) for (let y = -bound; y <= bound; y++) for (let z = -bound; z <= bound; z++) {
        const squared = x * x + y * y + z * z, length = Math.sqrt(squared);
        if (length > 0 && length <= bound && Number.isInteger(length)) vectors.push([x, y, z]);
    }
    for (const u of vectors) for (const v of vectors) {
        const squared = dot(u, u), length = Math.sqrt(squared);
        if (dot(v, v) !== squared || dot(u, v) !== 0) continue;
        const w: Vector = [(u[1] * v[2] - u[2] * v[1]) / length,
            (u[2] * v[0] - u[0] * v[2]) / length, (u[0] * v[1] - u[1] * v[0]) / length];
        if (!w.every(Number.isInteger)) continue;
        const low = u.map((value, i) => Math.min(0, value) + Math.min(0, v[i]) + Math.min(0, w[i])) as Vector;
        const span = u.map((value, i) => Math.abs(value) + Math.abs(v[i]) + Math.abs(w[i])) as Vector;
        if (span.some(value => value > bound)) continue;
        const vertices: string[] = [];
        for (let bits = 0; bits < 8; bits++) vertices.push(u.map((value, i) =>
            (bits & 1 ? value : 0) + (bits & 2 ? v[i] : 0) + (bits & 4 ? w[i] : 0) - low[i]).join(','));
        const key = vertices.sort().join(';');
        if (cubes.has(key)) continue;
        cubes.add(key);
        let points = 0;
        for (let x = 0; x <= span[0]; x++) for (let y = 0; y <= span[1]; y++) for (let z = 0; z <= span[2]; z++) {
            const point: Vector = [x + low[0], y + low[1], z + low[2]];
            if ([u, v, w].every(edge => { const projection = dot(point, edge); return projection >= 0 && projection <= squared; })) points++;
        }
        answer += points * span.reduce((product, width) => product * (bound + 1 - width), 1);
    }
    return BigInt(answer);
}
function run(n: number, options: InterpreterOptions = {}, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(text); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
const small = Array.from({ length: 6 }, (_, n) => [n, direct(n)] as const);
describe.each([{}, { compilation: false }, { scalarFunctionCompilation: false, numberLoopCompilation: false }])('Euler 579 %j', options => {
    it.each(small)('matches direct cube geometry in box %s', (n, answer) => expect(run(n, options)).toBe(answer));
    it.each([[10, 387003n], [50, 948928129n], [5000, 3805524n]] as const)('retains the checkpoint at %s', (n, answer) => {
        expect(run(n, options)).toBe(answer);
    }, 30000);
});
it.each([6, 7, 9, 13, 25, 49, 64, 100, 150, 200])('matches the original unrestricted quaternion search at %s', n => {
    expect(run(n)).toBe(run(n, {}, original));
}, 30000);
