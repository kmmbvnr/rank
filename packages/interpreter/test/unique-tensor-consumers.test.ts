import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, type NativeFunction, type RankValue } from '../src/index.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

function execute(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute('use sequences\nuse numbers\n' + source)); }
        catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        return { diagnostics, error, state: [...runtime.variables].map(([key, value]) => [key, formatValue(value)]) };
    } finally { runtime.dispose(); }
}

describe.each(['unique', 'unique len', 'unique sort'])('native integer plan %s', consumer => {
    it.each([
        "Input = array 3 1 3 2\nPlan' = Input mod 3",
        "Input = array 3 1 3 2\nNext' = Input + 1\nPlan' = concat Input Next",
        "Input = array shape 0 fill 1\nPlan' = Input + 0",
        "Input = array 9007199254740992 9007199254740993 9007199254740992\nPlan' = Input + 1",
        "Input = array 9007199254740992 9007199254740993 9007199254740992\nPlan' = Input * Input",
        "Input = array 1 9007199254740993 1\nPlan' = Input * Input",
        "Input = array 1 0 2\nPlan' = 12 // Input\nBefore = 7",
        "Input = array 1 2\nPlan' = (Input + 0) reshape 1 2",
    ])('matches reference values and first errors: %s', setup => {
        const source = setup + `\nAnswer = Plan ${consumer}`;
        const actual = execute(source, true), expected = execute(source, false);
        expect({ state: actual.state, error: actual.error }).toEqual({ state: expected.state, error: expected.error });
    });

    it('preserves captures, repeated demands, completion and result ownership', () => {
        const source = `Input = array 3 1 3 2
Plan' = Input + 0
Unused' = (array 1 0) // 0
Saved = Plan ${consumer}
First = Plan ${consumer}
Copy = Input copy
Copy 0 = 9
Second = Plan ${consumer}
Input = array 7 7 8 8
Third = Plan ${consumer}
Answer = Saved`;
        const actual = execute(source, true), expected = execute(source, false);
        expect(actual.error).toBeUndefined();
        expect(actual.state).toEqual(expected.state);
        expect(actual.diagnostics.compiledTensors).toBeGreaterThan(0);
    });

    it('keeps captured inputs read-only until explicitly copied', () => {
        const source = `Input = array 3 1 3\nPlan' = Input + 0\nSaved = Plan ${consumer}\nInput 0 = 9`;
        const actual = execute(source, true), expected = execute(source, false);
        expect(actual.error).toContain('read-only');
        expect({ state: actual.state, error: actual.error }).toEqual({ state: expected.state, error: expected.error });
    });

    it('retains opaque source read order without speculative reads', () => {
        const observe = (compilation: boolean) => {
            const runtime = new Interpreter(() => {}, { compilation }), reads: number[] = [];
            try {
                runtime.execute('use sequences');
                runtime.variables.set('Input', { kind: 'array', shape: [4], items: [],
                    itemAt(index) { reads.push(index); return [3n, 1n, 3n, 2n][index]; } });
                runtime.execute("Plan' = Input + 0");
                expect(reads).toEqual([]);
                const answer = formatValue(runtime.execute(`Plan ${consumer}`)!);
                return { answer, reads };
            } finally { runtime.dispose(); }
        };
        expect(observe(true)).toEqual(observe(false));
    });

    it('keeps cancellation private without publishing a partial result', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute("use sequences\nInput = 1 to 10000 array\nPlan' = Input mod 3");
            expect(() => withDemandBudget(100, () => runtime.execute(`Answer = Plan ${consumer}`)))
                .toThrow(DemandBudgetExhausted);
            expect(runtime.variables.get('Answer')).toBeUndefined();
            expect(formatValue(runtime.execute(`Plan ${consumer}`)!)).toBe(
                consumer === 'unique len' ? '3' : consumer === 'unique sort' ? '0 1 2' : '1 2 0');
        } finally { runtime.dispose(); }
    });
});

it('preserves first occurrence order, and counts without a unique result array', () => {
    const ordered = execute("Input = array 3 1 3 2\nPlan' = concat Input (Input + 1)\nAnswer = Plan unique", true);
    expect(ordered.state).toContainEqual(['Answer', '3 1 2 4']);
    expect(ordered.diagnostics.compiledDistincts).toBe(1);
    expect(ordered.diagnostics.cellsComputed).toBe(0);
    const count = execute("Input = array 3 1 3 2\nPlan' = concat Input (Input + 1)\nAnswer = Plan unique len", true);
    expect(count.state).toContainEqual(['Answer', '4']);
    expect(count.diagnostics.compiledDistincts).toBe(1);
    expect(count.diagnostics.cellsComputed).toBe(0);
});

it('does not replace a modified unique implementation', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute("use sequences\nInput = array 3 1 3\nPlan' = Input + 0\nu = unique");
        const unique = runtime.variables.get('u') as NativeFunction, original = unique.call;
        try {
            Object.defineProperty(unique, 'call', { configurable: true, value: (_args: RankValue[]) => 99n });
            expect(runtime.execute('Plan u')).toBe(99n);
        } finally { Object.defineProperty(unique, 'call', { configurable: true, value: original }); }
    } finally { runtime.dispose(); }
});
