import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

function execute(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source);
    expect(result.state).toEqual(execute(source, false).state);
    return result;
}

describe('read-only array aliases in Number regions', () => {
    it('refreshes dimensions when a matrix alias switches tables in a mixed region', () => {
        const result = compare(`A = array shape 2 3 fill 2
B = array shape 3 2 fill 3
T = A
S = 9007199254740992
for Mode in 0 to 1
 T = A
 if Mode equal 1
  T = B
 end
 for I in 0 to 1
  S += T Mode I
 end
end
B 1 0 = 99
After = T 1 0`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['S', '9007199254741002']);
        expect(result.state.variables).toContainEqual(['After', '3']);
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    });

    it('switches between external tables and preserves snapshots after publication', () => {
        const result = compare(`A = array 1 2
B = array 10 20
T = A
S = 0
for Mode in 0 to 1
 T = A
 if Mode equal 1
  T = B
 end
 for I in 0 to 1
  S += T I
 end
end
B 0 = 99
After = T 0`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['S', '33']);
        expect(result.state.variables).toContainEqual(['After', '10']);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('supports chained aliases of fresh private arrays', () => {
        const result = compare(`A = array 0 0
B = A
C = A
S = 0
for I in 0 to 2
 A = array shape 2 fill I
 B = A
 C = B
 S += C 0
end
A 0 = 100
After = C 0`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['After', '2']);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('publishes completed aliases and scalar writes before a later error', () => {
        const result = compare(`A = array 1 2
S = 0
for I in 0 to 2
 B = A
 S += B I
end`);
        expect(result.state.error).toContain('out of bounds');
        expect(result.state.variables).toContainEqual(['S', '3']);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('replays an overflowing attempt without duplicating prior scalar work', () => {
        const result = compare(`A = array 9007199254740991 2
S = 0
for I in 0 to 1
 B = A
 S += B I
end`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['S', '9007199254740993']);
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    });

    it.each(['A 0 += 1', 'B 0 += 1', 'C 0 += 1'])(
        'retains copy-on-write behavior for mutable alias regions: %s', store => {
            const result = compare(`A = array 1 2
S = 0
for I in 0 to 1
 B = A
 C = B
 ${store}
 S += A 0 + B 0 + C 0
end`);
            expect(result.state.error).toBeUndefined();
        });

    it('keeps a preexisting alias on an unassigned branch', () => {
        const result = compare(`A = array 1 2
B = array 10 20
T = B
S = 0
for I in 0 to 1
 if I equal 1
  T = A
 end
 S += T I
end`);
        expect(result.state.error).toBeUndefined();
        expect(result.state.variables).toContainEqual(['S', '12']);
    });
});
