import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/790_clockgrid.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler790-original.ra', import.meta.url), 'utf8');
const side = 50515093;

// Independent compressed raster: visit each rectangle's cells, then sum areas.
// Generate the sequence by repeated squaring, not exponent reduction.
function reference(steps: number) {
    let state = 290797n;
    const rectangles: number[][] = [], xs = new Set([0, side]), ys = new Set([0, side]);
    for (let i = 0; i < steps; i++) {
        const values: number[] = [];
        for (let j = 0; j < 4; j++) { values.push(Number(state)); state = state * state % BigInt(side); }
        const [a, b, c, d] = values;
        const rectangle = [Math.min(a, b), Math.max(a, b) + 1, Math.min(c, d), Math.max(c, d) + 1];
        rectangles.push(rectangle);
        xs.add(rectangle[0]); xs.add(rectangle[1]); ys.add(rectangle[2]); ys.add(rectangle[3]);
    }
    const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b);
    const cells = new Uint32Array((x.length - 1) * (y.length - 1));
    for (const [left, right, bottom, top] of rectangles) {
        for (let i = x.indexOf(left); i < x.indexOf(right); i++) for (let j = y.indexOf(bottom); j < y.indexOf(top); j++) cells[i * (y.length - 1) + j]++;
    }
    let answer = 0n;
    for (let i = 0; i + 1 < x.length; i++) for (let j = 0; j + 1 < y.length; j++) {
        const hour = cells[i * (y.length - 1) + j] % 12 || 12;
        answer += BigInt(x[i + 1] - x[i]) * BigInt(y[j + 1] - y[j]) * BigInt(hour);
    }
    return answer;
}
const expected = new Map([0, 1, 2, 10, 25, 100].map(steps => [steps, reference(steps)]));

describe.each([false, true])('Euler 790 compilation=%s', compilation => {
    it.each([0, 1, 2, 10, 25, 100])('matches independent raster at Steps=%s across block boundaries', steps => {
        for (const chunk of [1, 4, 17, 512]) {
            const runtime = new Interpreter(() => {}, { compilation, args: [`--steps=${steps}`, `--chunk=${chunk}`] });
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Answer'), `chunk=${chunk}`).toBe(expected.get(steps));
            } finally { runtime.dispose(); }
        }
    });
});
it('retains the original 1000-rectangle answer and uses an exact mixed loop', () => {
    for (const program of [original, source]) {
        const runtime = new Interpreter(() => {}, { args: ['--steps=1000'] });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(program));
            expect(runtime.variables.get('Answer')).toBe(16486236070816953n);
            if (program === source) expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    }
}, 60_000);
