import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/352_bloodtests.ra', import.meta.url), 'utf8');
const helpers = source.slice(0, source.indexOf('\nSum ='));
// Full split enumeration: no Cap, pool pruning or precomputed costs.
function oracle(p: number, size: number): number {
    const q = 1 - p, t = new Float64Array(size + 1), c = new Float64Array(size + 1);
    const pow = new Float64Array(size + 1);
    pow[0] = 1; t[1] = 1;
    for (let i = 1; i <= size; i++) pow[i] = pow[i - 1] * q;
    for (let n = 2; n <= size; n++) {
        let best = size;
        const den = 1 - pow[n];
        for (let m = 1; m < n; m++) {
            let value = 1 + (pow[m] - pow[n]) / den * c[n - m];
            value += (1 - pow[m]) / den * (c[m] + t[n - m]);
            best = Math.min(best, value);
        }
        c[n] = best; best = size;
        for (let m = 1; m <= n; m++) {
            let value = 1 + t[n - m];
            value += (1 - pow[m]) * c[m];
            best = Math.min(best, value);
        }
        t[n] = best;
    }
    return t[size];
}
const cases: [number, number][] = [];
for (let i = 1; i <= 50; i++) cases.push([i / 100, 25]);
for (const n of [1, 2, 3, 10, 51, 100, 256, 512]) {
    for (const p of [.01, .02, .03, .10, .25, .4, .5]) cases.push([p, n]);
}
let seed = 12345;
for (let i = 0; i < 20; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    cases.push([(1 + seed % 50) / 100, 1 + seed % 200]);
}
const expected = cases.map(([p, n]) => oracle(p, n));
for (const compilation of [false, true]) {
    it(`matches uncapped DP across pool and prefix boundaries (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(helpers);
            cases.forEach(([p, n], i) => expect(runtime.execute(`${p} blood ${n}`)).toBe(expected[i]));
            expect(() => runtime.execute('0.1 blood 0')).toThrow();
        } finally { runtime.dispose(); }
    }, 45_000);

    if (compilation) it(`preserves the full blood-test answer (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(378563.260589);
            if (compilation) {
                expect(diagnostics.numberFunctions).toBe(50);
                expect(diagnostics.numberFunctionFallbacks).toBe(0);
            }
        } finally { runtime.dispose(); }
    }, 90_000);
}
