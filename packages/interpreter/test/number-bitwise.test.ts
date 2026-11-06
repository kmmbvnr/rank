import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { numberBitwiseSource } from '../src/jit/operator-codegen.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget } from '../src/interrupt.js';

const operations = ['band', 'bor', 'bxor'] as const;
function exact(operation: typeof operations[number], left: bigint, right: bigint): bigint {
    return operation === 'band' ? left & right : operation === 'bor' ? left | right : left ^ right;
}
const values = [0n, 1n, -1n, 31n, -32n, 2n ** 31n - 1n, 2n ** 31n, -(2n ** 31n),
    2n ** 32n - 1n, 2n ** 32n, -(2n ** 32n), 2n ** 45n + 7n, -(2n ** 45n + 7n),
    2n ** 52n - 1n, 2n ** 52n, 2n ** 53n - 1n, -(2n ** 53n - 1n)];

describe('safe Number logical bitwise operations', () => {
    it.each(operations)('matches independent BigInt %s across signed high/low boundaries', operation => {
        const generated = new Function('left', 'right', `return ${numberBitwiseSource(operation, 'left', 'right')};`) as (a: number, b: number) => number;
        for (const left of values) for (const right of values) {
            const result = generated(Number(left), Number(right)), expected = exact(operation, left, right);
            if (expected > -9007199254740992n && expected < 9007199254740992n) {
                expect(Number.isSafeInteger(result)).toBe(true);
                expect(BigInt(result)).toBe(expected);
            } else expect(Number.isSafeInteger(result)).toBe(false);
        }
    });

    it.each(operations)('keeps a wide safe %s loop numeric', operation => {
        const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
        const left = 2n ** 45n + 7n, right = 2n ** 44n + 3n;
        try {
            expect(diagnostics.run(() => runtime.execute(`use bits
Left = ${left}
Right = ${right}
Total = 0
for I in 1 to 10
 Total += Left ${operation} Right
end
Total`))).toBe(10n * exact(operation, left, right));
            expect(diagnostics.numberLoops).toBe(1);
            expect(diagnostics.numberLoopOverflows).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each(operations)('compiles scalar %s helpers with safe wide operands', operation => {
        const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`use bits\nfun Left mask Right\n return Left ${operation} Right\nend`);
            for (const left of values) {
                const expected = exact(operation, left, 35184372088835n);
                expect(diagnostics.run(() => runtime.execute(`${left} mask 35184372088835`))).toBe(expected);
            }
            expect(diagnostics.numberFunctions).toBeGreaterThan(0);
            const huge = 2n ** 100n + 7n;
            expect(runtime.execute(`${huge} mask -1`)).toBe(exact(operation, huge, -1n));
        } finally { runtime.dispose(); }
    });

    it('replays an unsafe result without duplicating mutations or changing aliases', () => {
        const source = `use bits
A = array 1 2
Saved = A
Result = 0
for I in 1 to 3
 A 0 += 1
 Result = -1 bxor 9007199254740991
end
tuple Result A Saved`;
        const diagnostics = new RuntimeDiagnostics();
        const before = new Interpreter(() => {}, { compilation: false }), after = new Interpreter();
        try {
            expect(formatValue(diagnostics.run(() => after.execute(source))!))
                .toBe(formatValue(before.execute(source)!));
            expect(after.variables.get('Result')).toBe(-9007199254740992n);
            expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
        } finally { before.dispose(); after.dispose(); }
    });

    it('rechecks live builtin identity after a warm numeric call', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use bits\nfun Left mask Right\n return Left band Right\nend');
            expect(runtime.execute('35184372088835 mask 3')).toBe(3n);
            runtime.variables.set('band', native('band', 2, args => (args[0] as bigint) + (args[1] as bigint)));
            expect(runtime.execute('35184372088835 mask 3')).toBe(35184372088838n);
        } finally { runtime.dispose(); }
    });

    it('keeps demand checks after warming a helper with a numeric loop', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use bits
fun Limit tally
 Total = 0
 for I in 1 to Limit
  Total += I bor 35184372088832
 end
 return Total
end`);
            expect(runtime.execute('10 tally')).toBe(351843720888375n);
            expect(() => withDemandBudget(5, () => runtime.execute('100 tally'))).toThrow('demand budget exhausted');
            expect(runtime.execute('10 tally')).toBe(351843720888375n);
        } finally { runtime.dispose(); }
    });
});
