import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, RuntimeDiagnostics } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';
import { withDemandBudget } from '../src/interrupt.js';

const input = [-2147483648, -17, 0, 1000000006, 2147483647, 19];
const keys = [0, 3, 0, 1, 3, 1];
const mod = (x: bigint, m: bigint) => (x % m + m) % m;
function expected(kind: string, op: string, values: readonly number[], keys: readonly number[], m: bigint, seed?: bigint) {
    const states = Array<bigint>(6).fill(mod(seed ?? (op === '+' ? 0n : 1n), m));
    const output: bigint[] = [];
    values.forEach((value, i) => {
        const key = keys[i];
        states[key] = mod(op === '+' ? states[key] + BigInt(value) : states[key] * BigInt(value), m);
        output.push(states[key]);
    });
    return kind === 'scan' ? output : states;
}
for (const compilation of [false, true]) describe(`packed modular keyed folds, compilation=${compilation}`, () => {
    for (const kind of ['scan', 'reduce']) for (const op of ['+', '*']) for (const m of [1n, 7n, 1000000007n, 1073741824n]) for (const seed of [undefined, -5n]) {
        it(`${kind} ${op} mod ${m}, seed ${seed}`, () => {
            const runtime = new Interpreter(() => {}, { compilation });
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.variables.set('Values', typedArray(Int32Array.from(input), [2, 3]));
                runtime.variables.set('Keys', typedArray(Int32Array.from(keys), [2, 3]));
                runtime.variables.set('Mod', m);
                const source = `(Values ${kind} ${op} by Keys${seed === undefined ? '' : ' with (-5)'} size 6) mod Mod`;
                const result = diagnostics.run(() => runtime.execute(source));
                if (result === undefined || !isRankArray(result)) throw Error('expected array');
                expect(result.shape).toEqual(kind === 'scan' ? [2, 3] : [6]);
                expect(Array.from({ length: 6 }, (_, i) => readArrayItem(result, i))).toEqual(expected(kind, op, input, keys, m, seed));
                expect(diagnostics.integerKeyedFolds).toBe(1);
            } finally { runtime.dispose(); }
        });
    }
    it('retains sparse scan state without dense private allocation', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Values', typedArray(Int32Array.from([3, 5, 7, 11]), [4]));
            runtime.variables.set('Keys', typedArray(Int32Array.from([0, 1000000, 0, 1000000]), [4]));
            const result = diagnostics.run(() => runtime.execute('(Values scan * by Keys) mod 17'));
            if (result === undefined || !isRankArray(result)) throw Error('expected array');
            expect(result.items).toEqual([3n, 5n, 4n, 4n]);
            expect(diagnostics.integerKeyedFolds).toBe(0);
        } finally { runtime.dispose(); }
    });
    it('retains ordinary budget charging', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Values', typedArray(Int32Array.from(input), [6]));
            runtime.variables.set('Keys', typedArray(Int32Array.from(keys), [6]));
            const result = diagnostics.run(() => withDemandBudget(1000, () => runtime.execute('(Values reduce + by Keys size 6) mod 7')));
            if (result === undefined || !isRankArray(result)) throw Error('expected array');
            expect(result.items).toEqual(expected('reduce', '+', input, keys, 7n));
            expect(diagnostics.integerKeyedFolds).toBe(0);
        } finally { runtime.dispose(); }
    });
});
