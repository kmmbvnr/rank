import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/399_squarefree.ra', import.meta.url), 'utf8');

function fibonacci(n: bigint, modulus: bigint): bigint {
    if (n === 0n) return 0n;
    function pair(n: bigint): [bigint, bigint] {
        if (n === 0n) return [0n, 1n];
        const [a, b] = pair(n / 2n);
        const c = (a * (2n * b - a) % modulus + modulus) % modulus;
        const d = (a * a + b * b) % modulus;
        return n % 2n ? [d, (c + d) % modulus] : [c, d];
    }
    return pair(n)[0];
}

describe('Euler 399 compiled modular doubling', () => {
    it('matches exact arithmetic for small and final-output moduli', () => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute('use numbers\nuse bits\n' + source.slice(source.indexOf('rem Fast doubling')));
            const fn = runtime.variables.get('fibmod');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing fibmod');
            for (const modulus of [2n, 11n, 5714281n, 10000000000000000n]) {
                let a = 0n, b = 1n;
                for (let n = 0n; n < 50n; n++) {
                    expect(fn.call([n, modulus])).toBe(a);
                    [a, b] = [b, (a + b) % modulus];
                }
                for (const n of [12345n, 200000000n, 9007199254740993n]) {
                    expect(fn.call([n, modulus])).toBe(fibonacci(n, modulus));
                }
            }
            expect(calls).toBe(212);
        } finally { runtime.dispose(); }
    });

    it('selects a squarefree index against independent prime-square recurrence', () => {
        const limit = 2000, count = 1000;
        const forbidden = new Uint8Array(limit + 1), composite = new Uint8Array(1001);
        for (let p = 2; p <= 1000; p++) {
            if (composite[p]) continue;
            for (let m = p * p; m <= 1000; m += p) composite[m] = 1;
            let a = 0, b = 1;
            for (let n = 1; n <= limit; n++) {
                [a, b] = [b, (a + b) % (p * p)];
                if (a === 0) forbidden[n] = 1;
            }
        }
        const allowed = Array.from({ length: limit }, (_, i) => i + 1).filter(n => !forbidden[n]);
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source.replace('option Count integer = 100000000', `option Count integer = ${count}`)
                .replace('option Limit integer = 200000000', `option Limit integer = ${limit}`)
                .replace('option PrimeLimit integer = 5714285', 'option PrimeLimit integer = 1000'));
            expect(runtime.variables.get('Index')).toBe(BigInt(allowed[count - 1]));
        } finally { runtime.dispose(); }
    });
});
