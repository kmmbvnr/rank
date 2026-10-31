import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

function execute(source: string, compilation = true, numberLoopCompilation = false) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, numberLoopCompilation = false) {
    const result = execute(source, true, numberLoopCompilation);
    expect(result.state).toEqual(execute(source, false).state);
    return result;
}

describe('aliases bound inside exact regions', () => {
    it.each([false, true])('protects the source on repeated writable bindings (Number enabled: %s)', numbers => {
        const result = compare(`A = array 1 2 3
Total = 0
for I in 0 to 2
 B = A
 for J in 0 to 2
  B J += 1
 end
 Total += B 0
end`, numbers);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['A', '1 2 3']);
        expect(result.state.variables).toContainEqual(['Total', '6']);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it('retains the old source after rebinding its name', () => {
        const result = compare(`A = array 1 2
Other = array 10 20
Original = A
Total = 0
for I in 0 to 1
 B = A
 A = Other
 B 0 += 1
 Total += B 0
end`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['Original', '1 2']);
        expect(result.state.variables).toContainEqual(['Other', '10 20']);
        expect(result.state.variables).toContainEqual(['Total', '13']);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('publishes alias writes before an error without changing its source', () => {
        const result = compare(`A = array 1 2
B = A
for I in 0 to 2
 B = A
 B 0 = 9
 B I += 1
end`);
        expect(result.state.error).toContain('out of bounds');
        expect(result.state.variables).toContainEqual(['A', '1 2']);
        expect(result.state.variables).toContainEqual(['B', '9 2']);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('protects chained aliases through the existing conservative path', () => {
        const result = compare(`A = array 1 2
B = A
C = A
Total = 0
for I in 0 to 1
 B = A
 C = B
 C I += 10
 Total += C I
end`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['A', '1 2']);
        expect(result.state.variables).toContainEqual(['B', '1 2']);
        expect(result.state.variables).toContainEqual(['C', '1 12']);
        expect(result.state.variables).toContainEqual(['Total', '23']);
    });

    it('leaves read-only aliases shared', () => {
        const result = compare(`A = array 1 2
Total = 0
for I in 0 to 1
 B = A
 Total += B I
end`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['Total', '3']);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.cowCopies).toBe(0);
    });
});
