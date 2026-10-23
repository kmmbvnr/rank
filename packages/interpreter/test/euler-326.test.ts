import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/326_modulosums.ra', import.meta.url), 'utf8');
const definition = source.slice(source.indexOf('fun N pairs M'));

// Direct definition of a_n and all contiguous sums; no period decomposition.
function brutePairs(n: number, m: number): bigint {
    const terms = [0n, 1n];
    for (let i = 2; i <= n; i++) {
        let weight = 0n;
        for (let k = 1; k < i; k++) weight += BigInt(k) * terms[k];
        terms[i] = weight % BigInt(i);
    }
    let answer = 0n;
    for (let start = 1; start <= n; start++) {
        let sum = 0n;
        for (let end = start; end <= n; end++) {
            sum += terms[end];
            if (sum % BigInt(m) === 0n) answer++;
        }
    }
    return answer;
}

describe('Euler 326 dense residue counters', () => {
    it.each([{}, { numberLoopCompilation: false }, { compilation: false }])(
        'matches direct contiguous sums across period boundaries: %o', options => {
            const runtime = new Interpreter(() => {}, options);
            try {
                runtime.execute(definition);
                for (const m of [1, 2, 3, 7, 10]) {
                    for (const n of [0, 1, 6 * m - 1, 6 * m, 6 * m + 1, 12 * m + 2]) {
                        expect(runtime.execute(`${n} pairs ${m}`), `N=${n}, M=${m}`)
                            .toBe(brutePairs(n, m));
                    }
                }
            } finally { runtime.dispose(); }
        });

    it('replays both counter arrays exactly when a scalar accumulator overflows', () => {
        const program = `Seen = array shape 4096 fill 0
Tail = array shape 4096 fill 0
Original = Seen
Weight = 9007199254740989
for I in 0 till 8
 Seen (I mod 2) += 1
 if I at most 4
  Tail (I mod 2) += 1
 end
 Weight += I
end
S = Seen 0 + Seen 1
T = Tail 0 + Tail 1
Old = Original 0`;
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, options), diagnostics = new RuntimeDiagnostics();
            try {
                diagnostics.run(() => runtime.execute(program));
                expect(runtime.variables.get('S')).toBe(8n);
                expect(runtime.variables.get('T')).toBe(5n);
                expect(runtime.variables.get('Old')).toBe(0n);
                expect(runtime.variables.get('Weight')).toBe(9007199254741017n);
                if (!Object.keys(options).length) {
                    expect(diagnostics.numberLoopOverflows).toBe(1);
                    expect(diagnostics.typedUnpacks).toBe(0);
                }
            } finally { runtime.dispose(); }
        }
    });
});
