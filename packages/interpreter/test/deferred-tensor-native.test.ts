import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { completed } from '../src/execution.js';
import { isRankPlan } from '../src/plan.js';
import { withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';

function observe(body: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute('use sequences\nuse numbers\n' + body)); }
        catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        const value = runtime.variables.get('Answer');
        return { answer: value === undefined ? undefined : formatValue(value), error,
            plans: [...runtime.variables].filter(([, value]) => isRankPlan(value)).map(([name]) => name), diagnostics };
    } finally { runtime.dispose(); }
}

describe('native deferred integer tensor recipes', () => {
    it.each([
        "Input = array 2 4 6\nColumn' = Input reshape 3 1\nWide' = Column + (array 1 2)\nMask' = Wide greater 4\nAnswer = Wide filter Mask",
        "Input = array 10 20 30\nKeys = array 2 0 2 1\nGrid' = Keys reshape 2 2\nValues' = Input Grid\nMask' = Grid greater 0\nAnswer = Values filter Mask",
        "Input = array -7 -1 0 1 7\nValues' = Input // -3\nMask' = Input mod -3 equal -1\nAnswer = Values filter Mask",
        "Input = array 1 2 3\nValues' = Input * 2147483648\nAnswer = Values copy",
        "Input = array 9007199254740992 9007199254740993\nValues' = Input + 1\nAnswer = Values copy",
        "Input = array 1 2 3\nValues' = Input * (2 ** 100)\nAnswer = Values copy",
        "Input = array 1 2 3\nColumn' = Input reshape 3 1\nValues' = Column + (array 4 5)\nAnswer = Values copy",
        "Input = array 1 0 2\nValues' = 10 // Input\nMask' = Input greater 0\nAnswer = Values filter Mask",
        "Input = array 1 0 2\nValues' = 10 // Input\nAnswer = Values copy",
        // Every selector must be validated, including unselected positions.
        "Input = array 10 20\nKeys = array 0 9\nValues' = Input Keys\nMask = array true false\nAnswer = Values filter Mask",
        "Input = array 10 20\nKeys = array 0 -1\nValues' = Input Keys\nMask = array false false\nAnswer = Values filter Mask",
        "Input = array 1 0\nBad' = 10 // Input\nKeys = array 0 9\nValues' = Bad Keys\nAnswer = Values copy",
        "Input = array 10 20 30\nKeys = array 2 0\nMiddle' = Input Keys\nOuter = array 1 0 1\nValues' = Middle Outer\nAnswer = Values copy",
        "Input = array 10 20\nKeys = array shape 0 fill 0\nValues' = Input Keys\nAnswer = Values copy",
        "Input = array shape 0 2 fill 1\nValues' = Input + 2\nAnswer = Values copy",
        "Input = array 1 2\nValues' = Input reshape 3 1\nAnswer = Values copy",
        "Input = array 1 2\nValues' = Input + (array 1 2 3)\nAnswer = Values copy",
        "Unused' = (array 1 0) // 0\nAnswer = 7",
        "Unused' = false and (1 // 0 equal 1)\nAnswer = Unused",
        "Unused' = true or (1 // 0 equal 1)\nAnswer = Unused",
        "Input = array 1 2 3\nAlias = Input\nValues' = Input * 2\nAlias 0 = 99\nSaved = Values\nInput = array 9\nAgain = Values\nAnswer = array (Saved sum) (Again sum)",
        "fun Input stage\n Column' = Input reshape 3 1\n Wide' = Column + (array 10 20)\n return Wide\nend\nValues' = (array 1 2 3) stage\nAnswer = Values copy",
    ])('matches values, plan bindings and first located errors: %s', source => {
        const actual = observe(source, true), expected = observe(source, false);
        expect({ answer: actual.answer, error: actual.error, plans: actual.plans })
            .toEqual({ answer: expected.answer, error: expected.error, plans: expected.plans });
    });

    it('compiles a broadcast/gather mask without intermediate cell evaluation', () => {
        const result = observe(`Input = 1 to 100 array
Keys = 0 to 99 array
Offsets = array 0 0 0
Column' = Keys reshape 100 1
Grid' = Column + Offsets
Values' = Input Grid
Mask' = Values mod 3 equal 0
Answer = Values filter Mask`, true);
        expect(result.error).toBeUndefined();
        expect(result.diagnostics.numberTensors).toBeGreaterThan(0);
        expect(result.diagnostics.cellsComputed).toBeLessThan(10);
    });

    it('does not inspect arbitrary host plan expressions or demand them ahead', () => {
        const execute = (compilation: boolean) => {
            let calls = 0;
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.variables.set('Host', { kind: 'plan', dependencies: new Map(),
                    get expression(): never { throw Error('opaque expression'); },
                    evaluate: () => { calls++; return completed(3n); } });
                runtime.execute("Later' = Host * 2");
                expect(calls).toBe(0);
                return { value: runtime.execute('Later'), calls };
            } finally { runtime.dispose(); }
        };
        expect(execute(true)).toEqual(execute(false));
    });

    it('rechecks demand budgets after a native recipe has been compiled', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute("use sequences\nuse numbers\nInput = 1 to 10000 array\nColumn' = Input reshape 10000 1\nValues' = Column + (array 1 2)\nMask' = Values greater 0");
            const demand = () => runtime.execute('Answer = (Values filter Mask) sum');
            expect(demand()).toBe(100040000n);
            runtime.execute('Answer = 7');
            expect(() => withDemandBudget(100, demand)).toThrow(DemandBudgetExhausted);
            expect(runtime.variables.get('Answer')).toBe(7n);
            expect(demand()).toBe(100040000n);
        } finally { runtime.dispose(); }
    });
});
