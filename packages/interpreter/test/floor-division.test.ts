import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';

const large = (1n << 100n) + 7n;
const inputs = [0n, 7n, -7n, 9n, -9n, large, -large];
const divisors = [3n, -3n, large, -large];

for (const tier of ['expression', 'function', 'loop'] as const) describe(`floor division in ${tier}`, () => {
    function run(a: bigint, b: bigint) {
        let executed = 0;
        const options: InterpreterOptions = tier === 'expression'
            ? { scalarEntryCompilation: false, tensorFusion: false, onScalarExecuted: () => executed++ }
            : tier === 'function' ? { onScalarFunctionExecuted: () => executed++ }
            : { scalarEntryCompilation: false, numberLoopCompilation: false, onIntegerLoopExecuted: () => executed++ };
        const runtime = new Interpreter(() => {}, options);
        const source = tier === 'expression' ? `A = ${a}\nB = ${b}\nResult = (A + 0) // B`
            : tier === 'function' ? `fun A quotient B\n return A // B\nend\nResult = ${a} quotient ${b}`
            : `A = ${a}\nB = ${b}\nResult = 0\nfor I in 1 to 2\n Result = A // B\nend`;
        try {
            runtime.execute(source);
            expect(executed).toBeGreaterThan(0);
            return runtime.variables.get('Result');
        } finally { runtime.dispose(); }
    }

    for (const a of inputs) it.each(divisors)(`rounds ${a} // %s down exactly`, b => {
        const truncated = a / b;
        const expected = truncated - ((a < 0n) !== (b < 0n) && a % b !== 0n ? 1n : 0n);
        expect(run(a, b)).toBe(expected);
    });

    it.each([0n, 7n, -large])('retains division by zero for %s', a => {
        expect(() => run(a, 0n)).toThrow('division by zero');
    });
});
