import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/316_decimals.ra', import.meta.url), 'utf8');
const definition = source.slice(source.indexOf('fun N waiting'));

// Enumerate string borders independently of the demo's integer arithmetic.
function expected(n: bigint): bigint {
    const text = String(n);
    let total = 0n;
    for (let size = 1; size <= text.length; size++) {
        if (text.startsWith(text.slice(-size))) total += 10n ** BigInt(size);
    }
    return total - BigInt(text.length) + 1n;
}

describe('Euler 316 numeric borders', () => {
    for (const compilation of [false, true]) {
        it(`matches an independent border oracle (compilation=${compilation})`, () => {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(`use sequences
${definition}
Results = array shape 1000 fill 0
for I in 1 to 1000
  Results (I - 1) = I waiting
end`);
                const result = r.variables.get('Results');
                expect(result && isRankArray(result)).toBe(true);
                if (result && isRankArray(result)) {
                    expect(result.items).toEqual(Array.from({ length: 1000 }, (_, i) => expected(BigInt(i + 1))));
                }
                for (const n of [535n, 1111n, 1212n, 10101n, 1111111111111111n,
                    1212121212121212n, 10000000000000001n, 10000000000000000n]) {
                    expect(r.execute(`${n} waiting`)).toBe(expected(n));
                }
            } finally { r.dispose(); }
        });

        it(`passes the official sample sum (compilation=${compilation})`, () => {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(source.replace('arg Top integer = 999999', 'Top = 999')
                    .replace('arg Num integer = 10000000000000000', 'Num = 1000000'));
                expect(r.variables.get('Answer')).toBe(27280188n);
            } finally { r.dispose(); }
        });
    }

    it('compiles the full default workload including the waiting-time function', () => {
        const r = new Interpreter(() => {});
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => r.execute(source));
            expect(r.variables.get('Answer')).toBe(542934735751917735n);
            expect(diagnostics.compiledLoops).toBe(1);
        } finally { r.dispose(); }
    });
});
