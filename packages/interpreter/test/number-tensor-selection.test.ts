import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

function run(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute('use sequences\nuse numbers\n' + source)); }
        catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        const answer = runtime.variables.get('Answer');
        return { answer: answer === undefined ? undefined : formatValue(answer), error, diagnostics };
    } finally { runtime.dispose(); }
}

describe('private integer tensor mask consumers', () => {
    it.each([
        "Input = 1 to 5000 array\nMask' = Input mod 3 not equal 0\nValues' = 10000 // (Input + 1)",
        "Input = -20 to 20 array\nMask' = Input mod -3 not equal 0\nValues' = Input // -3",
        "Input = 1 to 20 array\nMask' = Input less 5 or Input greater 15\nValues' = 40 - Input * 2",
        "Input = array shape 0 fill 1\nMask' = Input equal 1\nValues' = Input + 2",
        "Input = array 1 2 3\nMask' = Input less 0\nValues' = Input // 0",
        "Input = array 1 0 2\nMask' = Input greater 0\nValues' = 12 // Input",
        "Input = array 1 0 2\nMask' = (12 // Input) greater 0\nValues' = Input + 1",
        "Input = array 1 2 3\nMask' = Input greater 0\nValues' = Input * 4503599627370495",
        "Input = array 1 1 1\nMask' = Input greater 0\nValues' = Input + 4503599627370495",
        "Input = array 9007199254740992 9007199254740993\nMask' = Input equal 9007199254740993\nValues' = Input + 1",
        "Input = array 1 2 3\nMask' = Input greater 0\nValues' = (9007199254740991 - Input) // 3",
        "Input = array 1 2 3\nMask' = (array 1 2) greater 0\nValues' = Input + 1",
        "Input = array 1 2 3\nMask' = Input + 0\nValues' = Input + 1",
        "Input = array 1 2 3\nMask' = Input greater 0\nValues' = Input * 0.5",
    ])('matches exact execution and first errors: %s', setup => {
        const source = setup + '\nAnswer = (Values filter Mask) sum';
        const actual = run(source, true), expected = run(source, false);
        expect({ answer: actual.answer, error: actual.error }).toEqual({ answer: expected.answer, error: expected.error });
    });

    it('uses checked numeric mask and selected-value consumers', () => {
        const actual = run("Input = 1 to 5000 array\nMask' = Input mod 3 equal 1\nValues' = 10000 // (Input + 1)\nAnswer = (Values filter Mask) sum", true);
        expect(actual.error).toBeUndefined();
        expect(actual.diagnostics.numberTensors).toBe(2);
        expect(actual.diagnostics.cellsComputed).toBeLessThan(10);
    });

    it('preserves snapshots, repeated demands and ordinary completion', () => {
        const source = `Input = 1 to 30 array
Mask' = Input mod 3 equal 1
Values' = 100 // (Input + 1)
Selected' = Values filter Mask
First = Selected sum
Saved = Values
Input = 100 to 130 array
Second = Selected sum
Answer = array First Second (Saved sum)`;
        const actual = run(source, true);
        expect(actual.error).toBeUndefined();
        expect(actual.answer).toEqual(run(source, false).answer);
    });

    it('does not inspect opaque readers speculatively', () => {
        const execute = (compilation: boolean) => {
            const runtime = new Interpreter(() => {}, { compilation }), reads: number[] = [];
            try {
                runtime.execute('use sequences\nuse numbers');
                runtime.variables.set('Input', { kind: 'array', shape: [3], items: [],
                    itemAt(i) { reads.push(i); return BigInt(i + 1); } });
                runtime.execute("Mask' = Input greater 1\nValues' = Input * 2");
                expect(reads).toEqual([]);
                runtime.execute('Answer = (Values filter Mask) sum');
                return { answer: runtime.variables.get('Answer'), reads };
            } finally { runtime.dispose(); }
        };
        expect(execute(true)).toEqual(execute(false));
    });

    it('respects replaced selection iteration', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute("use sequences\nuse numbers\nInput = 1 to 30 array\nMask' = Input greater 0\nValues' = Input + 1\nSelected' = Values filter Mask");
            const selected = runtime.execute('Selected');
            if (typeof selected !== 'object' || selected.kind !== 'sequence') throw new Error('expected selection');
            selected.plan.iterate = function* () { yield 77n; };
            runtime.variables.set('Replaced', selected);
            runtime.execute('Answer = Replaced sum');
            expect(runtime.variables.get('Answer')).toBe(77n);
        } finally { runtime.dispose(); }
    });

    it('cancels without publishing a partial sum and can be demanded again', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute("use sequences\nuse numbers\nInput = 1 to 10000 array\nMask' = Input greater 0\nValues' = Input + 1");
            expect(() => withDemandBudget(5000, () => runtime.execute('Answer = (Values filter Mask) sum'))).toThrow(DemandBudgetExhausted);
            expect(runtime.variables.has('Answer')).toBe(false);
            runtime.execute('Answer = (Values filter Mask) sum');
            expect(runtime.variables.get('Answer')).toBe(50015000n);
        } finally { runtime.dispose(); }
    });

    it('retains exact gcd for negative Int32 minima and arbitrarily wide cells', () => {
        const source = `Input = array -2147483648 0 1 (2 ** 2000)
Answer = (Input gcd (array 0 -2147483648 7 2)) sum`;
        const actual = run(source, true);
        expect(actual.error).toBeUndefined();
        expect(actual.answer).toBe('4294967299');
        expect(actual.answer).toBe(run(source, false).answer);
    });
});
