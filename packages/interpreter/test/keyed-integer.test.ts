import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';

for (const operation of ['+', '*', 'min', 'max']) {
    for (const kind of ['reduce', 'scan']) {
        it(`${kind} ${operation} agrees with ordered BigInt reference after widening`, () => {
            const values = Int32Array.from({ length: 80 }, (_, i) => i % 7 === 0 ? -2147483648 : 2147483647);
            const keys = Int32Array.from(values, (_, i) => i % 3);
            const seed = 9007199254740991n;
            const states = Array(3).fill(seed) as bigint[];
            const prefixes: bigint[] = [];
            for (let i = 0; i < values.length; i++) {
                const at = keys[i], value = BigInt(values[i]), previous = states[at];
                states[at] = operation === '+' ? previous + value : operation === '*' ? previous * value
                    : operation === 'min' ? previous < value ? previous : value : previous > value ? previous : value;
                prefixes.push(states[at]);
            }
            for (const compilation of [true, false]) {
                const runtime = new Interpreter(() => {}, { compilation });
                const diagnostics = new RuntimeDiagnostics();
                try {
                    runtime.variables.set('V', typedArray(values));
                    runtime.variables.set('K', typedArray(keys));
                    const result = diagnostics.run(() => runtime.execute(`V ${kind} ${operation} by K with ${seed}`));
                    if (result === undefined || !isRankArray(result)) throw new Error('expected array');
                    const expected = kind === 'scan' ? prefixes : states;
                    expect(Array.from({ length: expected.length }, (_, i) => readArrayItem(result, i))).toEqual(expected);
                    expect(diagnostics.integerKeyedFolds).toBe(compilation ? 1 : 0);
                } finally { runtime.dispose(); }
            }
        });
    }
}
