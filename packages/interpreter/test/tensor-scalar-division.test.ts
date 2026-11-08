import { expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, parse, type RankValue } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';

it.each(['//', 'mod'])('folds a proven nonzero integer %s before a tensor domain', operation => {
    const source = `Result = (Input + (Scalar ${operation} Divisor)) copy`;
    const values = new Map<string, RankValue>([['Input', typedArray(Int32Array.from({ length: 128 }, (_, i) => i))]]);
    let compiled = 0;
    const kernel = compileTensorKernel(parse(source).statements[0], {
        lookup: name => values.get(name), builtin: () => true, compiled: () => compiled++,
    })!;
    expect(kernel).toBeDefined();
    const reference = new Interpreter(undefined, { compilation: false });
    try {
        for (const scalar of [10n, -10n, 0n, 2n ** 80n + 17n]) for (const divisor of [3n, -3n]) {
            values.set('Scalar', scalar); values.set('Divisor', divisor);
            for (const [name, value] of values) reference.variables.set(name, value);
            expect(formatValue(kernel.run()!)).toBe(formatValue(reference.execute(`use sequences\n${source}`)!));
        }
        expect(compiled).toBeGreaterThan(0);
        values.set('Divisor', 0n);
        expect(kernel.run()).toBeUndefined();
        values.set('Divisor', 7n);
        for (const [name, value] of values) reference.variables.set(name, value);
        expect(formatValue(kernel.run()!)).toBe(formatValue(reference.execute(`use sequences\n${source}`)!));
    } finally { reference.dispose(); }
});

it.each(['//', 'mod'])('retains scalar %s errors before empty and nonempty arrays', operation => {
    for (const size of [0, 128]) {
        const source = `use sequences
Input = array shape ${size} fill 1
Scalar = -10
Divisor = 0
Result = (Input + (Scalar ${operation} Divisor)) copy`;
        function run(compilation: boolean) {
            const r = new Interpreter(undefined, { compilation });
            try { r.execute(source); }
            catch (error) { return error instanceof RankError ? error.format() : String(error); }
            finally { r.dispose(); }
            return undefined;
        }
        const expected = run(false);
        expect(expected).toMatch(/zero/);
        expect(run(true)).toBe(expected);
    }
});

it.each(['//', 'mod'])('does not fold broader numeric %s domains as integers', operation => {
    const values = new Map<string, RankValue>([['Input', typedArray(new Int32Array(128))], ['Scalar', -10.5], ['Divisor', 3]]);
    const kernel = compileTensorKernel(parse(`Result = (Input + (Scalar ${operation} Divisor)) copy`).statements[0], {
        lookup: name => values.get(name), builtin: () => true,
    });
    expect(kernel?.run()).toBeUndefined();
});
