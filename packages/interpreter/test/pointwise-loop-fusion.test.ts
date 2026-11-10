import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function execute(source: string, compilation = true, numberLoopCompilation = true, budget?: number) {
    let code = '';
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation,
        scalarEntryCompilation: false, onIntegerLoopCompiled: value => { code = value; } });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => budget === undefined ? runtime.execute(source) : withDemandBudget(budget, () => runtime.execute(source))); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { code, diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const actual = execute(source);
    expect(actual.observation).toEqual(execute(source, false).observation);
    expect(actual.observation).toEqual(execute(source, true, false).observation);
    return actual;
}

describe('independent pointwise loop bindings', () => {
    it('fuses modular results while retaining snapshots', () => {
        const actual = compare(`A = array 1 4 9
M = array 2 6 8
Q = array 7 11 13
Saved = A
for I in 1 to 3
 A = (A + M * I) mod Q
 M = M * 5 mod Q
end`);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.code).toContain('fusedCell');
        expect(actual.diagnostics.numberLoops).toBe(1);
    });
    it('joins boolean, integer and real outputs', () => {
        const actual = compare(`A = array -3 0 7
M = array 2 6 8
Q = array 7 11 13
Hit = array false false false
Real = array -0.0 1.5 -2.5
for I in 1 to 2
 Hit = Hit or (A equal 0)
 A = (A + M * I) mod Q
 M = M * 5 mod Q
 Real = Real * -1.0
end`);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.code).toContain('fusedCell');
        expect(actual.code).toMatch(/fusedArray\d+\.cells\[fusedCell\d+\] =/);
        expect(actual.diagnostics.numberLoops).toBe(1);
    });
    it.each(['array 1 2', 'array 1', 'array shape 0 fill 0'])('retains separate geometries for %s', input => {
        const actual = compare(`A = ${input}
B = array 1 2 3 4
for I in 1 to 2
 A = A + I
 B = B * I
end`);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.diagnostics.numberLoops).toBe(1);
        expect(actual.diagnostics.numberLoopOverflows).toBe(0);
    });
    it('promotes integer outputs beyond signed words', () => {
        const actual = compare(`A = array 2147483646 -2147483648
B = array 1 2
for I in 1 to 3
 A = A + I
 B = B + 1
end`);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.observation.variables).toContainEqual(['A', '2147483652 -2147483642']);
        expect(actual.code).toContain('fusedCell');
        expect(actual.diagnostics.numberLoopOverflows).toBe(0);
    });
    it.each([
        ['array 1 9007199254740991', 'array 0 1'],
        ['array 1 2', 'array 1 0'],
        ['array 1 2', 'array 0 1'],
    ])('replays error and binding order for %s / %s', (a, divisor) => {
        const actual = compare(`A = ${a}
B = array 2 3
Divisor = ${divisor}
for I in 1 to 2
 A = A + 1
 B = B // Divisor
end`);
        expect(actual.observation.error).toBeDefined();
    });
    it('stops at a binding dependency', () => {
        const actual = compare(`A = array 1 2 3
B = array 3 2 1
for I in 1 to 2
 A = A + 1
 B = A * 2
end`);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.code).not.toContain('fusedCell');
    });
    it.each([50, 100, 200])('retains observable completion boundaries with budget %s', budget => {
        const source = `A = array 1 2 3 4
B = array 2 3 4 5
for I in 1 to 20
 A = A + 1
 B = B * 2
end`;
        expect(execute(source, true, true, budget).observation).toEqual(execute(source, true, false, budget).observation);
    });
    it('keeps plain aliases on their existing ownership route', () => {
        const actual = compare(`A = array 0 0
B = array 0 0
C = array 0 0
for I in 1 to 6
 A = B
 B = B + 1
 C = B * 2
end`);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.diagnostics.numberLoops).toBe(0);
    });
});
