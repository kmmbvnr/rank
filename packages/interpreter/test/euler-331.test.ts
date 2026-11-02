import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/331_crossflips.ra', import.meta.url), 'utf8');
const definition = source.slice(source.indexOf('fun N turns'));

// Independent board enumeration, without a boundary walk.
function direct(n: number): bigint {
    const black = (x: number, y: number) => Number(
        x * x + y * y >= (n - 1) ** 2 && x * x + y * y < n * n);
    const parity = Array.from({ length: n }, (_, x) => {
        let sum = 0;
        for (let y = 0; y < n; y++) sum += black(x, y);
        return sum % 2;
    });
    let count = 0;
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
        count += (black(x, y) + parity[x] + parity[y]) % 2;
    }
    return BigInt(count);
}

describe('Euler 331 streamed rows', () => {
    it.each([{}, { numberLoopCompilation: false }, { compilation: false }])(
        'matches direct flips including diagonal row endings: %o', options => {
            const runtime = new Interpreter(() => {}, options);
            try {
                runtime.execute(definition);
                for (let n = 2; n <= 128; n += 2) {
                    expect(runtime.execute(`${n} turns`), `N=${n}`).toBe(direct(n));
                }
                for (const [n, expected] of [[5, 3n], [7, 0n], [1000, 395253n], [10000, 38413231n]] as const) {
                    expect(runtime.execute(`${n} turns`), `N=${n}`).toBe(expected);
                }
            } finally { runtime.dispose(); }
        });

    it('retains the exact full answer above the safe Number range', () => {
        let compiled = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => compiled++ });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Sum')).toBe(467178235146843549n);
            expect(compiled).toBeGreaterThanOrEqual(14);
        } finally { runtime.dispose(); }
    });
});
