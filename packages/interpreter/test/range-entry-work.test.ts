import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, parse } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

const source = `use sequences
N = 300000
A = array shape (N + 1) fill 0
Count = 0
for P in 2 to 4
 Slots = (P to N by P) copy
 A Slots = 7
 Count += 1
end`;
function execute(text: string, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { numberLoopCompilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(text));
        return { diagnostics, values: [runtime.execute('A 0'), runtime.execute('A 2'),
            runtime.execute('A 12'), runtime.execute('A N'), runtime.execute('Count')] };
    } finally { runtime.dispose(); }
}

describe('range entry work without changing copy thresholds', () => {
    it.each(['2 to 4', '4 to 2 by -1'])('counts three leading passes over %s', range => {
        const text = source.replace('2 to 4', range), result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.values).toEqual([0n, 7n, 7n, 7n, 3n]);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
    });
    it.each([
        source.replace('2 to 4', '2 to 2'),
        source.replace('2 to 4', '2 to 3'),
        source.replace(' Slots =', ' if P greater 2\n  break\n end\n Slots ='),
        source.replace(' Slots =', ' if P equal 2\n  continue\n end\n Slots ='),
        source.replace(' A Slots =', ' N -= 1\n A Slots ='),
        source.replace(' A Slots =', ' Slots = 1 to 1 copy\n A Slots ='),
    ])('declines insufficient/unknown work %#', text => {
        const result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });
    it.each(['P less 5', 'true', 'Flag'])('counts selector work through Boolean conversion: %s', predicate => {
        const text = source.replace('Count =', 'Flag = true\nCount =')
            .replace(' Slots =', ` Active = ${predicate} integer\n Stride = P * Active\n Slots =`)
            .replace('(P to N by P)', '(P to N by Stride)');
        const result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('keeps the completed range length after its scalar bound changes', () => {
        const text = source.replace(' Slots =', ' End = N // P\n Slots =')
            .replace('(P to N by P)', '(1 to End)').replace(' A Slots =', ' End = 0\n A Slots =');
        const result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it.each(['Slots + 0', '0 + Slots', '(Slots * 2) // 2', 'Slots + (Slots - Slots)'])(
        'counts completed pointwise selectors: %s', selector => {
            const text = source.replace(' A Slots =', ` Target = ${selector}\n A Target =`);
            const result = execute(text);
            expect(result.values).toEqual(execute(text, false).values);
            expect(result.values).toEqual([0n, 7n, 7n, 7n, 3n]);
            expect(result.diagnostics.numberLoops).toBe(1);
            expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
        });
    it('does not assume an unknown vector is a scalar broadcast', () => {
        const text = source.replace('Count =', 'Other = array 0\nCount =')
            .replace(' A Slots =', ' Target = Slots + Other\n A Target =');
        const result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });
    it('does not reuse a selector length after a shorter replacement', () => {
        const text = source.replace(' A Slots =', ' Slots = 2 to 2 copy\n Target = Slots + 0\n A Target =');
        const result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.diagnostics.numberLoops).toBe(0);
    });
    it.each([undefined, 2000])('preserves prior stores and failure with derived selectors (budget=%s)', budget => {
        const text = source.replace(' A Slots =', ' Target = Slots + (P - 2)\n A Target =');
        function run(numberLoopCompilation: boolean) {
            const runtime = new Interpreter(() => {}, { numberLoopCompilation });
            const diagnostics = new RuntimeDiagnostics();
            let error: string | undefined;
            try {
                try {
                    diagnostics.run(() => budget === undefined ? runtime.execute(text)
                        : withDemandBudget(budget, () => runtime.execute(text)));
                } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
                return { diagnostics, state: { error,
                    count: runtime.variables.get('Count'), p: runtime.variables.get('P'),
                    cells: [2, 3, 6, 300000].map(index => runtime.execute(`A ${index}`)) } };
            } finally { runtime.dispose(); }
        }
        const result = run(true);
        expect(result.state).toEqual(run(false).state);
        expect(result.state.error).toBeDefined();
        if (budget === undefined) {
            expect(result.state.cells).toEqual([7n, 0n, 7n, 7n]);
            expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
        } else expect(result.diagnostics.numberLoops).toBe(0);
    });
});

it('rechecks changing bounds and stride on a reused range admission plan', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const size = 300000;
    try {
        runtime.execute(`use sequences\nA = array shape ${size + 1} fill 0`);
        const program = parse('for I in Start to End by Step\n A I = I\nend');
        for (const [start, end, step] of [[1, size, 1], [1, 1, 1], [size, 1, -1]]) {
            runtime.variables.set('Start', BigInt(start));
            runtime.variables.set('End', BigInt(end));
            runtime.variables.set('Step', BigInt(step));
            diagnostics.run(() => runtime.executeProgram(program));
        }
        expect(runtime.execute('A 1')).toBe(1n);
        expect(runtime.execute(`A ${size}`)).toBe(BigInt(size));
        expect(diagnostics.numberLoops).toBe(2);
        runtime.variables.set('Step', 0n);
        expect(() => runtime.executeProgram(program)).toThrow(/step/);
    } finally { runtime.dispose(); }
});
