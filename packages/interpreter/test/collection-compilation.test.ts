import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, RankError } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics();
    let calls = 0, error: string | undefined;
    const measured = new Interpreter(() => {}, { ...options, onScalarFunctionExecuted: () => calls++ });
    try {
        try { diagnostics.run(() => measured.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, calls, observation: { error, variables: [...measured.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { measured.dispose(); }
}
function compare(source: string) {
    const candidate = execute(source);
    expect(candidate.observation).toEqual(execute(source, { compilation: false }).observation);
    expect(candidate.observation.error).toBeUndefined();
    return candidate;
}

describe('compiled collection operations', () => {
    it.each(['in', 'not in'])('prepares %s once per array filter and preserves order and duplicates', operator => {
        const source = `Vals = array 4 2 4 3 1\nDomain = array 4 1 4\nNeighbors = Domain take 2\nLater = Vals drop 1\nNext = Later filter ${operator} Neighbors\nAnswer = Next array`;
        const result = compare(source);
        expect(result.diagnostics.integerMembershipFilters).toBe(1);
        expect(result.diagnostics.fallbacks['scalar-expression:unsupported-op:in']).toBeUndefined();
        expect(result.observation.variables.at(-1)).toEqual(['Answer', operator === 'in' ? '4 1' : '2 3']);
    });

    it('uses immutable integer neighbor snapshots on either side of membership', () => {
        const result = compare(`use graph
Graph = new graph (array 1 2 3 4) .undirected
Graph add 1 3
Graph add 1 2
Graph add 1 3
Neighbors = Graph 1
Graph add 1 4
Vals = array 4 3 2 1
Domain = Vals take 3
Next = Neighbors filter greater 1 filter in Domain
Answer = Next array
Other = Vals filter in Neighbors
OtherAnswer = Other array`);
        expect(result.diagnostics.integerMembershipFilters).toBe(2);
        expect(result.observation.variables.slice(-3)).toContainEqual(['Answer', '3 2 3']);
        expect(result.observation.variables.at(-1)).toEqual(['OtherAnswer', '3 2']);
    });

    it('observes array changes between independent preparations', () => {
        const result = compare('Vals = array 1 2 3\nDomain = array 1 2\nA = Vals filter in Domain array\nDomain 0 = 3\nB = Vals filter in Domain array');
        expect(result.observation.variables.at(-1)).toEqual(['B', '2 3']);
        expect(result.diagnostics.integerMembershipFilters).toBe(2);
    });

    it('retains generic mixed, empty and structural membership', () => {
        compare('Vals = array 1 2 3\nDomain = array 2.0\nAnswer = Vals filter in Domain array');
        compare('Vals = array shape 0 fill 0\nDomain = array 2\nAnswer = Vals filter not in Domain array');
        compare('Vals = array "a" "b"\nDomain = array "b"\nAnswer = Vals filter in Domain array');
    });

    it.each(['in', 'not in'])('links captured array %s inside scalar kernels', operator => {
        const result = compare(`Domain = array 2 4\nfun X member\n return X ${operator} Domain\nend\nAnswer = 2 member\nDomain 0 = 3\nOther = 2 member`);
        expect(result.calls).toBeGreaterThan(0);
        expect(result.observation.variables.at(-1)).toEqual(['Other', operator === 'in' ? 'false' : 'true']);
    });

    it('compiles integer-array membership parameters in linked scalar calls', () => {
        const result = compare(`fun X Domain member\n return X in Domain\nend\nDomain = array 2 4\nS = 0\nfor I in 1 to 5\n if I Domain member\n  S += 1\n end\nend`);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.observation.variables.at(-1)).toEqual(['S', '2']);
    });
});
