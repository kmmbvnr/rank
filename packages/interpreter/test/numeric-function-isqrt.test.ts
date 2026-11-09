import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse, formatValue, type NativeFunction, type RankValue } from '../src/index.js';
import { isFunctionStatement } from '@arrrank/language';
import { compileNumericFunction } from '../src/jit/numeric-function.js';
import { typedArray } from '../src/array-storage.js';

function root(n: bigint) {
    let low = 0n, high = n + 1n;
    while (high - low > 1n) { const mid = (low + high) / 2n; if (mid * mid <= n) low = mid; else high = mid; }
    return low;
}
const source = `use numbers
use sequences
fun Limit roots
 Positions = 0 till 8 copy
 Values = Limit - Positions
 Roots = Values isqrt
 return Roots sum
end`;
function run(limit: bigint, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(source);
        const fn = runtime.variables.get('roots') as NativeFunction;
        return { value: diagnostics.run(() => fn.call([limit])), diagnostics };
    } finally { runtime.dispose(); }
}
describe('structural numeric integer square roots', () => {
    it.each([7n, 16n, 2147395603n, 9007199136250224n, 9007199136250225n, 9007199136250226n, 9007199254740991n])(
        'fuses exact roots and a sum near %s', limit => {
            const actual = run(limit);
            const expected = Array.from({ length: 8 }, (_, i) => root(limit - BigInt(i))).reduce((a, b) => a + b, 0n);
            expect(actual.value).toBe(expected);
            expect(actual.value).toBe(run(limit, false).value);
            expect(actual.diagnostics.compiledArrayFunctions).toBe(1);
        });
    it('preserves negative-domain errors through ordinary replay', () => {
        expect(() => run(6n)).toThrow('nonnegative');
        expect(() => run(6n, false)).toThrow('nonnegative');
    });
    it('keeps wider integers on the exact path', () => {
        const actual = run(1n << 70n);
        expect(actual.value).toBe(run(1n << 70n, false).value);
        expect(actual.diagnostics.compiledArrayFunctions).toBe(0);
    });
    it('maps roots through a tensor reshape', () => {
        const statement = parse(`use sequences
fun X roots
 Values = X reshape 2 4
 Roots = Values isqrt
 return Roots reshape #
end`).statements[1];
        if (!isFunctionStatement(statement)) throw Error('fixture');
        const values: RankValue = typedArray(new Int32Array([0, 1, 2, 3, 4, 8, 9, 2147395600]));
        let available = true, executed = 0;
        const plan = compileNumericFunction(statement, { lookup: () => values, builtin: () => available,
            compiled: () => {}, executed: () => executed++ })!;
        expect(formatValue(plan.run()!)).toBe('0 1 1 1 2 2 3 46340');
        available = false;
        expect(plan.run()).toBeUndefined();
        available = true;
        expect(formatValue(plan.run()!)).toBe('0 1 1 1 2 2 3 46340');
        expect(executed).toBe(2);
    });
});
