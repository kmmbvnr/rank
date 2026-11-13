import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
import { answerOf } from './support.js';

function observe(body: string, compilation: boolean, input = Float64Array.from({ length: 4096 }, (_, i) => i + 1)) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.variables.set('Input', typedArray(input.slice()));
        try {
            diagnostics.run(() => runtime.execute('use numbers\nuse sequences\n' + body));
            const result = answerOf(runtime);
            return { value: result && isRankArray(result)
                ? Array.from({ length: result.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(result, i)) : result,
                error: undefined, diagnostics };
        } catch (error) {
            return { value: undefined, error: error instanceof RankError ? error.format() : String(error), diagnostics };
        }
    } finally { runtime.dispose(); }
}

const chain = `Logs' = Input log
Estimate' = Logs + 0.5772156649015329
Harm' = Estimate + 0.5 / Input
Square' = Input ** 2
Corrected' = Harm - 1.0 / (12 * Square)
Ratio' = (Input / Corrected - 0.25) sqrt
Turn' = (Ratio / (Input + 0.5)) atan
Answer = Turn copy`;

describe('deferred real tensor recipes', () => {
    it('fuses real arithmetic and registered math without changing any cell', () => {
        const actual = observe(chain, true), reference = observe(chain, false);
        expect(actual.error).toBeUndefined();
        expect(actual.value).toEqual(reference.value);
        expect(actual.diagnostics.compiledTensors).toBeGreaterThan(0);
    });

    it.each([
        "Values' = (Input + 2) / (Input ** 2)\nAnswer = Values copy",
        "Column' = Input reshape 4096 1\nValues' = Column + (array 1.5 2.5)\nAnswer = Values copy",
        "Values' = -Input ** 2\nAnswer = Values copy",
        "Values' = Input sqrt\nAnswer = Values sum",
        "Values' = Input log\nAnswer = Values min",
        "Values' = Input atan\nAnswer = Values max",
        "Values' = Input log\nMask' = Values greater 2.5\nAnswer = Values filter Mask",
        "Unused' = (-Input) sqrt\nAnswer = 7",
        "Values' = (Input - 2) sqrt\nAnswer = Values copy",
        "Values' = (Input - 2) log\nAnswer = Values copy",
        "Values' = 1.0 / (Input - 2)\nAnswer = Values copy",
        "Values' = (Input - 2) sqrt\nAnswer = Values 1",
        "fun Value log\n return Value + 7.0\nend\nValues' = Input log\nAnswer = Values copy",
    ])('matches reference values and located failures: %s', body => {
        const actual = observe(body, true), reference = observe(body, false);
        expect({ value: actual.value, error: actual.error }).toEqual({ value: reference.value, error: reference.error });
    });

    it.each(['sqrt', 'atan', 'log'])('preserves %s signed zero, NaN, limits and domain errors', name => {
        for (const values of [[-0, 0, NaN, Infinity], [Infinity, 1.5, -Infinity, 0], [1, -1, 4, 9]]) {
            const input = Float64Array.from({ length: 4096 }, (_, i) => values[i % values.length]);
            const body = `Values' = Input ${name}\nAnswer = Values copy`;
            const actual = observe(body, true, input), reference = observe(body, false, input);
            expect({ value: actual.value, error: actual.error }).toEqual({ value: reference.value, error: reference.error });
        }
    });

    it('retains cancellation, budget failures and successful retry', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute("use numbers\nuse sequences\nInput = (1 to 4096) * 1.0\nValues' = (Input log + 0.5) sqrt");
            const demand = () => runtime.execute('Answer = Values copy');
            expect(() => withInterrupt(new Int32Array([1]), demand)).toThrow('Interrupted');
            expect(() => withDemandBudget(0, demand)).toThrow('demand budget exhausted');
            const result = demand();
            expect(result && isRankArray(result) && readArrayItem(result, 4095)).toBe(Math.sqrt(Math.log(4096) + 0.5));
        } finally { runtime.dispose(); }
    });
});
