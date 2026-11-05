import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { withDemandBudget, DemandBudgetExhausted, withInterrupt, InterruptedError } from '../src/interrupt.js';

function run(source: string, compilation: boolean, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation }), diagnostics = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try { value = formatValue(diagnostics.run(() => runtime.execute(source))!); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { value, error, variables: [...runtime.variables].map(([key, value]) => [key, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
const loop = (a: string, b: string) => `use sequences\nA = ${a}\nB = ${b}\nR = A\nfor I in 1 to 2\n R = A ** B\nend\nR`;
function compare(source: string) {
    const result = run(source, true);
    expect(result.observation).toEqual(run(source, false).observation);
    expect(result.observation).toEqual(run(source, true, false).observation);
    return result;
}
describe('stored and private vector powers', () => {
    it.each([
        ['array 2 3 4', 'array 5 3 2'],
        ['array -2 0 1', 'array 3 0 1000000000000000'],
        ['array 2', 'array 0 1 2 3 4'],
        ['(array 2 3) reshape 2 1', '(array 2 3 4) reshape 1 3'],
        ['(array 2 3) reshape 2 1 1', '(array 2 3 4) reshape 1 3 1'],
    ])('compiles %s ** %s', (a, b) => {
        const result = compare(loop(a, b));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each([
        ['array 2 3', 'array 53 34'],
        ['array 9007199254740993 2', 'array 2 3'],
        ['array 2 0', 'array -1 2'],
        ['array 0 2', 'array -1 2'],
        ['array -1 4', 'array 0.5 0.5'],
        ['array 1.5 4.0', 'array 3 0.5'],
        ['array shape 0 fill 2', 'array 0'],
        ['array shape 0 fill 2', 'array -1'],
        ['array 1 2', 'array 1 2 3'],
    ])('retains wide, negative, real and shape fallback: %s ** %s', (a, b) => {
        compare(loop(a, b));
    });
    it('keeps exact wide results and signed power precedence', () => {
        const result = compare('use sequences\nA = 1 to 70 copy\nP = 2 ** A\nN = -2 ** (array 2 3)\nP 69');
        expect(result.observation.value).toBe('1180591620717411303424');
    });
    it('does not use a rounded safe-looking JS power result as proof', () => {
        const source = 'use sequences\nA = array 13\nB = array 14\nA ** B';
        expect(compare(source).observation.value).toBe(String(13n ** 14n));
    });
    it('retains completed prior writes and the original zero-power error', () => {
        compare('use sequences\nA = array 0 2\nB = array -1 3\nR = A\nfor I in 1 to 1\n A 1 = 7\n R = A ** B\nend');
    });
    it('replays real vector domain errors after preceding stores', () => {
        const result = compare('use sequences\nA = array 4.0 -1.0\nB = array 0.5 0.5\nR = A\nfor I in 1 to 1\n A 0 = 9.0\n R = A ** B\nend');
        expect(result.observation.error).toContain('power result is not real');
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });
    it('does not force an unused deferred power', () => {
        compare("use sequences\nA = array 0 2\nP' = A ** -1\n42");
    });
    it('honors cancellation and budget', () => {
        const runtime = new Interpreter(() => {});
        const source = 'use sequences\nA = 0 to 10000 copy\n2 ** A';
        try {
            expect(() => withDemandBudget(5, () => runtime.execute(source))).toThrow(DemandBudgetExhausted);
            const signal = new Int32Array(new SharedArrayBuffer(4)); Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => runtime.execute(source))).toThrow(InterruptedError);
        } finally { runtime.dispose(); }
    });
});
