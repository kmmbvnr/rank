import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/781_feynmandiagrams.ra', import.meta.url), 'utf8');
// Literal exact recurrence: sum each suffix separately, with no scan, concat,
// fixed-width storage or intermediate modular reduction.
function exact(count: number): bigint {
    if (count % 2) return 0n;
    let profile = [0n, 1n];
    for (let size = 4; size <= count; size += 2) {
        const next: bigint[] = [];
        for (let j = 0; j < size; j++) {
            let suffix = 0n;
            for (let k = j; k < profile.length; k++) suffix += profile[k];
            next.push(suffix + (j >= 2 ? BigInt(j) * profile[j - 2] : 0n));
        }
        profile = next;
    }
    return profile.reduce((a, b) => a + b, 0n);
}
for (const compilation of [false, true]) describe(`Euler 781 (compiled=${compilation})`, () => {
    it.each([0, 1, 2, 3, 4, 8, 10, 16, 24, 40])('matches exact recurrence at %i', count => {
        for (const modulus of [7, 1000000007]) {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(source.replace('arg Count integer = 50000', `Count = ${count}`)
                    .replace('arg Mod integer = 1000000007', `Mod = ${modulus}`));
                expect(r.variables.get('Answer')).toBe(exact(count) % BigInt(modulus));
            } finally { r.dispose(); }
        }
    });
    it('retains the published examples', () => {
        expect(exact(4)).toBe(5n);
        expect(exact(8)).toBe(319n);
    });
});
