import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/338_gridpaper.ra', import.meta.url), 'utf8')
    .replace('use io', '').replace('use cli', '')
    .replace('arg Limit integer = 1000000000000', '')
    .replace('Limit grid print', '');

// Deliberately enumerate divisors and every outer index, without quotient blocks
// or permutation weights, to check the optimized counting independently.
function reference(n: number): bigint {
    let sum = 0n;
    for (let i = 2; i <= n; i++) {
        const a = Math.floor(n / i);
        let divisors = 0;
        for (let j = 1; j <= a; j++) divisors += Math.floor(a / j);
        sum += BigInt(a * Math.floor(n / (i - 1)) - divisors);
    }
    return sum;
}

describe('Euler 338 hyperbola counting', () => {
    it('computes the full target without materializing reciprocal ranges', () => {
        const output: string[] = [], kernels: string[] = [];
        const runtime = new Interpreter(text => output.push(text.trim()), {
            onIntegerLoopCompiled: code => kernels.push(code),
        });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(readFileSync(new URL('../../../demos/euler/338_gridpaper.ra', import.meta.url), 'utf8')));
            expect(output.at(-1)).toBe('999999999600010915614292');
            expect(diagnostics.numberLoops).toBe(1);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.typedArrayPublications).toBe(0);
            expect(kernels.some(code => code.includes('rangeCell'))).toBe(true);
            expect(kernels.every(code => !code.includes('rangeArray('))).toBe(true);
        } finally { runtime.dispose(); }
    }, 20000);
    for (const compilation of [true, false]) it(`matches enumeration around square and cube boundaries (compilation=${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source);
            const inputs = new Set([-100, -1, ...Array.from({ length: 301 }, (_, i) => i)]);
            for (const boundary of [81, 100, 121, 125, 144, 169, 196, 216, 225, 256, 343, 512, 729, 1000]) {
                for (const delta of [-1, 0, 1]) inputs.add(boundary + delta);
            }
            for (const n of inputs) {
                runtime.execute(`Answer = ${n} grid`);
                expect(runtime.variables.get('Answer'), `N=${n}`).toBe(reference(n));
            }
        } finally { runtime.dispose(); }
    });
});
