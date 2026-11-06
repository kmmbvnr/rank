import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/748_upsidedown.ra', import.meta.url), 'utf8');
function gcd(a: bigint, b: bigint): bigint { while (b) { const r = a % b; a = b; b = r; } return a; }
// Enumerate x,y directly in z^2*(x^2+y^2)=13*x^2*y^2.
// No Pythagorean/Gaussian parameterization or transformed-pair masks.
function direct(limit: number): bigint {
    let sum = 0n;
    const squares = new Map<bigint, bigint>();
    for (let z = 1n; z <= BigInt(limit); z++) squares.set(z * z, z);
    for (let x = 1; x <= limit; x++) for (let y = x; y <= limit; y++) {
        const a = BigInt(x * x), b = BigInt(y * y), numerator = 13n * a * b, denominator = a + b;
        if (numerator % denominator) continue;
        const z = squares.get(numerator / denominator);
        if (z !== undefined && gcd(gcd(BigInt(x), BigInt(y)), z) === 1n) sum += BigInt(x + y) + z;
    }
    return sum;
}
const cases = [0, 1, 5, 6, 10, 20, 50, 100, 200, 1000].map(limit => ({ limit, expected: direct(limit) }));
for (const compilation of [false, true]) describe(`Euler 748 (compiled=${compilation})`, () => {
    it.each(cases)('matches direct primitive solutions at Limit=$limit', ({ limit, expected }) => {
        for (const rows of [1, 2, 3, 64, 500]) {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(source.replace('arg Limit integer = 10 ** 16', `Limit = ${limit}`)
                    .replace(/arg Rows integer = \d+/, `Rows = ${rows}`));
                expect(r.variables.get('Answer')).toBe(expected % 1000000000n);
            } finally { r.dispose(); }
        }
    });
    it('keeps the existing Limit=100000 example and modular output', () => {
        for (const digits of [97, 1000000000]) {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(source.replace('arg Limit integer = 10 ** 16', 'Limit = 100000')
                    .replace('arg Digits integer = 1000000000', `Digits = ${digits}`));
                expect(r.variables.get('Answer')).toBe(2340084n % BigInt(digits));
            } finally { r.dispose(); }
        }
    });
});
