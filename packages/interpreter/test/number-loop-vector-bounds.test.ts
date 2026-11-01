import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type RankArray } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';

const cells = Int32Array.from({ length: 1024 }, (_, i) => [-2147483648, -3, -1, 0, 1, 2147483647][i % 6]);
const floor = (a: bigint, b: bigint) => a / b - (a % b !== 0n && (a < 0n) !== (b < 0n) ? 1n : 0n);
const mod = (a: bigint, b: bigint) => a - floor(a, b) * b;

describe('guarded Int32 vector intervals', () => {
    it.each([
        ['(A * 2 + 1) // 2', (x: bigint) => floor(x * 2n + 1n, 2n)],
        ['A * 2 + A mod 2', (x: bigint) => x * 2n + mod(x, 2n)],
        ['A // 3 + A mod 3', (x: bigint) => floor(x, 3n) + mod(x, 3n)],
        ['(A * 3 - 7) mod 97', (x: bigint) => mod(x * 3n - 7n, 97n)],
        ['A // 2147483648', (x: bigint) => floor(x, 2147483648n)],
        ['A mod 2147483648', (x: bigint) => mod(x, 2147483648n)],
        ['A // 4294967296', (x: bigint) => floor(x, 4294967296n)],
        ['A mod 4294967296', (x: bigint) => mod(x, 4294967296n)],
        ['A * 5000000', (x: bigint) => x * 5000000n],
    ] as const)('keeps exact results and aliases for %s', (formula, operation) => {
        let expected: bigint[] = Array.from(cells, BigInt);
        for (let i = 0; i < 3; i++) expected = expected.map(operation);
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.variables.set('Input', typedArray(cells.slice()));
                const result = diagnostics.run(() => runtime.execute(`A = Input
Saved = A
Count = 3
for Count greater 0
 A = ${formula}
 Count -= 1
end
A`));
                if (!result || !isRankArray(result)) throw Error('expected array');
                expect(result.items).toEqual(expected);
                expect((runtime.variables.get('Saved') as RankArray).items).toEqual(Array.from(cells, BigInt));
                if (compilation) expect(diagnostics.numberLoops + diagnostics.numberLoopOverflows).toBeGreaterThan(0);
            } finally { runtime.dispose(); }
        }
    });
    it('does not infer safe loads from a buffer with inconsistent geometry', () => {
        const observations = [];
        for (const numberLoopCompilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { numberLoopCompilation, scalarEntryCompilation: false });
            try {
                runtime.variables.set('Input', typedArray(new Int32Array([1, 2, 3, 4]), [2, 3]));
                try {
                    const result = runtime.execute(`A = Input
Count = 2
for Count greater 0
 A = (A mod 97) + 1
 Count -= 1
end
A`);
                    observations.push(isRankArray(result!) ? [...result.items] : result);
                } catch (error) { observations.push(String(error)); }
            } finally { runtime.dispose(); }
        }
        expect(observations[0]).toEqual(observations[1]);
    });

});
