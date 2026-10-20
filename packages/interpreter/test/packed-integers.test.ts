import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';
import { typedElementKind } from '../src/array-storage.js';

// Above the size from which integer arrays are packed.
const N = 10000;
const MAX = (1n << 63n) - 1n;

function run(source: string, names: string[] = []) {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        const packed = Object.fromEntries(names.map(name => {
            const array = runtime.variables.get(name);
            return [name, array && isRankArray(array) && typedElementKind(array) === 'integer'];
        }));
        return { value, packed, unpacks: diagnostics.typedUnpacks, loops: diagnostics.compiledLoops };
    } finally { runtime.dispose(); }
}

const sum = (count: number, cell: (index: bigint) => bigint) => {
    let total = 0n;
    for (let index = 0n; index < BigInt(count); index++) total += cell(index);
    return total;
};

describe('packed integer arrays', () => {
    it('keeps a range, its arithmetic and its sum packed', () => {
        expect(run(`Xs = 1 to ${N} array\nYs = Xs * Xs\nYs sum`, ['Xs', 'Ys'])).toEqual({
            value: sum(N, index => (index + 1n) ** 2n), packed: { Xs: true, Ys: true }, unpacks: 0, loops: 0,
        });
    });

    it('falls back to exact cells when a product leaves 64 bits', () => {
        const start = 3_000_000_000n;
        const result = run(`Xs = ${start} to ${start + BigInt(N - 1)} array\nYs = Xs * Xs * Xs\nYs sum`, ['Xs', 'Ys']);
        expect(result.value).toBe(sum(N, index => (start + index) ** 3n));
        expect(result.packed).toEqual({ Xs: true, Ys: false });
    });

    it('keeps a filled table packed under selection writes', () => {
        const source = `use sequences
Mu = array shape (${N} + 1) fill 1
for P in primes to ${N}
  Mu (P to ${N} by P) *= -1
  Mu (P * P to ${N} by P * P) = 0
end
Mu sum`;
        const mu = new Array<bigint>(N + 1).fill(1n);
        const composite = new Uint8Array(N + 1);
        for (let p = 2; p <= N; p++) {
            if (composite[p]) continue;
            for (let k = p * p; k <= N; k += p) composite[k] = 1;
            for (let k = p; k <= N; k += p) mu[k] *= -1n;
            for (let k = p * p; k <= N; k += p * p) mu[k] = 0n;
        }
        expect(run(source, ['Mu'])).toMatchObject({ value: mu.reduce((a, b) => a + b), packed: { Mu: true }, unpacks: 0 });
    });

    it('unpacks once when a selection write leaves 64 bits', () => {
        const result = run(`A = array shape ${N} fill ${MAX}\nA (0 to 9) += 1\nA sum`, ['A']);
        expect(result.value).toBe(MAX * BigInt(N) + 10n);
        expect(result).toMatchObject({ packed: { A: false }, unpacks: 1 });
    });

    it('writes single cells in place and exactly past 64 bits', () => {
        expect(run(`A = array shape ${N} fill 0\nA 5 = 7\nA 6 += 3\nA sum`, ['A']))
            .toMatchObject({ value: 10n, packed: { A: true }, unpacks: 0 });
        expect(run(`A = array shape ${N} fill 0\nA 6 = ${MAX}\nA 6 += 1\nA 6`, ['A']))
            .toMatchObject({ value: MAX + 1n, packed: { A: false } });
    });

    it('lets a compiled loop write a packed array in place', () => {
        const result = run(`A = array shape ${N} fill 0\nfor I in 0 till ${N}\n  A I = I * I\nend\nA sum`, ['A']);
        expect(result).toEqual({ value: sum(N, index => index * index), packed: { A: true }, unpacks: 0, loops: 1 });
    });

    it('reads the exact cells after a compiled loop write leaves 64 bits', () => {
        const step = MAX / 10n;
        const result = run(`A = array shape ${N} fill 1\nfor I in 1 till ${N}\n  A I = A (I - 1) + ${step}\nend\nA (${N} - 1)`, ['A']);
        expect(result).toMatchObject({ value: 1n + BigInt(N - 1) * step, packed: { A: false }, loops: 1 });
    });
});
