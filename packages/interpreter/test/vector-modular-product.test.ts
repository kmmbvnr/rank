import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { DemandBudgetExhausted, InterruptedError, withDemandBudget, withInterrupt } from '../src/interrupt.js';

const setup = 'A = array 1000000006 1000000004\nB = array 1000000005 1000000003';
const loop = (expression: string, input = setup) => `use sequences\n${input}\nR = A\nCount = 2\nfor Count greater 0\n R = ${expression}\n Count -= 1\nend\nR`;
function execute(source: string, compilation = true, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try { const result = diagnostics.run(() => runtime.execute(source)); value = result === undefined ? undefined : formatValue(result); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { value, error,
            variables: [...runtime.variables].map(([name, item]) => [name, formatValue(item)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source, true, true);
    expect(result.observation).toEqual(execute(source, false, true).observation);
    expect(result.observation).toEqual(execute(source, true, false).observation);
    return result;
}

describe('exact modular products in numeric vectors', () => {
    it('reaches the scalar modular multiplier without checking the wide product first', () => {
        const result = compare(loop('A * B mod 1000000007'));
        expect(result.observation.value).toBe('2 12');
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });
    it.each([2, 17, 94906266, 94906267, 1000000007, 1073741824])('keeps exact residues for modulus %s', modulus => {
        const result = compare(loop(`A * B mod ${modulus}`));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each([
        '(A * B) mod 1000000007', 'A * (B + 1) mod 1000000007',
        '(A + B) * (A - B) mod 1000000007',
        'A * (B mod 17) mod 1000000007',
    ])('retains nested integer expression %s', expression => {
        const result = compare(loop(expression));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });
    it('accepts signed safe integers beyond Int32', () => {
        const result = compare(loop('A * B mod 1000000007',
            'A = array -9007199254740991 9007199254740991 -1000000006\nB = array 9007199254740991 -9007199254740991 -1000000005'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });
    it.each([
        'A * B mod 1000000007', 'A * B mod C',
    ])('broadcasts all product/modulus operands in %s', expression => {
        const result = compare(loop(expression, `A = (array 1000000006 1000000004) reshape 2 1
B = (array 1000000005 1000000003 1000000001) reshape 1 3
C = (array 1000000007 1073741824 17) reshape 1 3`));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });
    it('broadcasts a higher-rank modulus', () => {
        const result = compare(loop('A * B mod C', `A = (array 1000000006 1000000004) reshape 2 1 1
B = (array 1000000005 1000000003 1000000001) reshape 1 3 1
C = (array 17 1000000007) reshape 1 1 2`));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each([0, -17, 1073741825, 9007199254740991])('replays unsupported/invalid modulus %s', modulus => {
        compare(loop(`A * B mod ${modulus}`));
    });
    it('retains literal and named BigInt moduli beyond safe Number range', () => {
        for (const modulus of ['9007199254740992', '9007199254740993', '9223372036854775809']) {
            const literal = compare(loop(`A * B mod ${modulus}`));
            const named = compare(loop('A * B mod P', `${setup}\nP = ${modulus}`));
            expect(literal.observation.error).toBeUndefined();
            expect(named.observation.error).toBeUndefined();
            expect(named.observation.value).toBe(literal.observation.value);
        }
    });
    it.each([0, 1])('keeps empty and singleton input demand, length %s', length => {
        for (const modulus of [0, 17, 1000000007]) compare(loop(`A * B mod ${modulus}`,
            `A = array shape ${length} fill 1000000006\nB = array shape 1 fill 1000000005`));
    });
    it('keeps shape failures ahead of invalid modulus failures', () => {
        compare(loop('A * B mod 0', 'A = array 1 2\nB = array 1 2 3'));
    });
    it.each(['A * B mod 17.0', 'A * B mod 17'])('retains the existing real fallback in %s', expression => {
        const result = compare(loop(expression, 'A = array 1.5 -0.0 -2.5\nB = array 2.0 3.0 5.5'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
    });
    it('keeps real arithmetic alongside a fused integer modular stage', () => {
        const text = loop('A * B', 'A = array 1.5 -0.0 -2.5\nB = array 2.0 3.0 5.5')
            .replace('Count = 2', 'C = array 1000000006 1000000004\nD = array 1000000005 1000000003\nS = C\nCount = 2')
            .replace(' Count -= 1', ' S = C * D mod 1000000007\n Count -= 1');
        const result = compare(text);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });
    it('does not remove a separately completed wide array binding', () => {
        const source = loop('Whole mod 1000000007').replace('Count = 2', 'Whole = A\nCount = 2')
            .replace(' R = Whole', ' Whole = A * B\n R = Whole');
        const result = compare(source);
        expect(result.observation.value).toBe('2 12');
        expect(result.observation.variables.find(([name]) => name === 'Whole')?.[1])
            .toBe(`${1000000006n * 1000000005n} ${1000000004n * 1000000003n}`);
    });
    it('retains preceding writes and the original division diagnostic', () => {
        compare(loop('A * (B // 0) mod 1000000007').replace(' R =', ' A 0 = 8\n R ='));
    });
    it('honors budgets and cancellation, then permits a normal invocation', () => {
        const runtime = new Interpreter(() => {});
        runtime.execute('use sequences\nA = 1 to 10000 copy\nB = A + 1000000000\nR = A');
        const source = 'Count = 2\nfor Count greater 0\n R = A * B mod 1000000007\n Count -= 1\nend\nR';
        try {
            expect(() => withDemandBudget(10, () => runtime.execute(source))).toThrow(DemandBudgetExhausted);
            const signal = new Int32Array(new SharedArrayBuffer(4)); Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => runtime.execute(source))).toThrow(InterruptedError);
            expect(() => runtime.execute(source)).not.toThrow();
        } finally { runtime.dispose(); }
    });
});
