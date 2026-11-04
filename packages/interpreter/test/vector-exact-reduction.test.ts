import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { DemandBudgetExhausted, InterruptedError, withDemandBudget, withInterrupt } from '../src/interrupt.js';

function run(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    let value: string | undefined, error: string | undefined;
    try {
        try {
            const result = diagnostics.run(() => runtime.execute(source));
            if (result !== undefined) value = formatValue(result);
        } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { value, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, compiled = true) {
    const result = run(source);
    expect(result.observation).toEqual(run(source, false).observation);
    if (compiled) expect(result.diagnostics.compiledLoops).toBeGreaterThan(0);
    return result;
}
const wide = 100000000000000003n;
function reduction(expression: string, setup = 'A = (1 to 100) copy\n B = (1 to 100) copy') {
    return `use sequences
N = ${wide}
Total = 0
for I in 1 to 2
 ${setup}
 Total += ${expression} sum
end
Total`;
}

describe('exact consumers of private numeric vectors', () => {
    it.each(['N // (A * B)', 'N mod (A * B)', 'A * B + N', 'N - A * B',
        'N // A // B', '(N + 1) // (A + B)', 'A * (N // B)'])('compiles %s with wide scalar inputs', expression => {
        const result = compare(reduction(expression));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    });
    it.each([9007199254740991n, 9007199254740992n, 9007199254740993n, -9007199254740993n])('keeps scalar boundary %s exact', n => {
        compare(reduction('N // (A * B)').replace(String(wide), String(n)));
    });
    it('promotes exact totals while retaining wide but safe Number cells', () => {
        compare(reduction('A * A', 'A = (1000000000000000 to 1000000000000001) copy'));
    });
    it('keeps products and totals beyond the safe Number range exact', () => {
        expect(compare(reduction('N // (A * B)', 'A = (100000000 to 100000001) copy\n B = (100000007 to 100000008) copy')).observation.value).toBe('36');
        expect(compare(reduction('A * B + N')).observation.value).toBe(String(200n * wide + 676700n));
    });
    it.each(['-3 to 3', '3 to -3 by -1', '3 till 3', '3 to 1'])('retains signed and empty arithmetic for %s', range => {
        expect(compare(reduction('N mod (A * A + 1)', `A = (${range}) copy`)).observation.error).toBeUndefined();
    });
    it.each(['array shape 1 fill -3', 'array shape 1 fill 1', 'array shape 0 fill 0'])('broadcasts singleton or empty arrays: %s', b => {
        expect(compare(reduction('N // (A * B + 1)', `A = (3 till 3) copy\n B = ${b}`), false).observation.value).toBe('0');
    });
    it.each([
        ['A = array 1 0\n B = array 0 1', 'N // A + N // B'],
        ['A = array 0 1\n B = array 1 2 3', 'N // A + B'],
        ['A = array shape 0 fill 0', 'A + (N // 0)'],
        ['A = array 1 0', 'N mod A'],
    ])('replays completed operand errors: %s / %s', (setup, expression) => {
        expect(compare(reduction(expression, setup), false).observation.error).toBeDefined();
    });
    it.each(['N // A + B', 'B + N // A'])('retains empty deferred arithmetic: %s', expression => {
        compare(reduction(expression, 'A = array shape 1 fill 0\n B = array shape 0 fill 0'), false);
    });
    it('retains aliases and completed vectors after stores and overflow replay', () => {
        compare(reduction('N // (A * A)', 'A = (1 to 100) copy\n Saved = A\n A 0 = I\n B = A + 1'), false);
        compare(reduction('N + A * A', 'A = (1 to 100) copy\n Saved = A\n A 0 = 9007199254740993'), false);
    });
    it('leaves higher-rank and real operands on their supported paths', () => {
        compare(reduction('N + A', 'A = array shape 2 2 fill 3'), false);
        compare(reduction('N + A', 'A = array 1.5 2.5'), false);
    });
    it('keeps builtin sum rebinding observable', () => {
        compare(`fun A sum\n return 7\nend\n${reduction('N + A')}`, false);
    });
    it('honors budgets and cancellation, then permits ordinary reuse', () => {
        const runtime = new Interpreter(() => {});
        const source = reduction('N // A', 'A = (1 to 10000) copy');
        try {
            expect(() => withDemandBudget(10, () => runtime.execute(source))).toThrow(DemandBudgetExhausted);
            const signal = new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => runtime.execute(source))).toThrow(InterruptedError);
            expect(runtime.execute('6 * 7')).toBe(42n);
        } finally { runtime.dispose(); }
    });
});

describe('copied progressions and grouped native vector calls', () => {
    it.each(['(1 to 100) copy', '(100 to 1 by -1) copy', '(5 till 5) copy'])('compiles fresh %s with a native mask', range => {
        const result = compare(`use sequences
use numbers
Total = 0
for I in 1 to 4
 A = ${range}
 A = A (I gcd A equal 1)
 Total += A sum
end
Total`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
    });
    it.each(['(1 to 3 by 0) copy', '(1 // 0 to 3) copy', '(1 to 3 // 0) copy'])('preserves copy argument error attribution: %s', range => {
        compare(reduction('N + A', `A = ${range}`), false);
    });
    it('retains copy and gcd binding guards', () => {
        compare(`fun X copy\n return X\nend\n${reduction('N + A')}`, false);
        compare(`fun X gcd Y
 return X + Y
end
use sequences
Total = 0
for I in 1 to 2
 A = (1 to 10) copy
 A = A (I gcd A equal 1)
 Total += A sum
end
Total`, false);
    });
});
