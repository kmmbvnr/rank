import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { error, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}

function compare(source: string) {
    const result = execute(source);
    expect(result.state).toEqual(execute(source, { compilation: false }).state);
    expect(result.state).toEqual(execute(source, { numberLoopCompilation: false }).state);
    return result;
}

// The tuple keeps the outer loop interpreted, so one compiled nested region
// is entered repeatedly, as with a deferred candidate input in Euler 154.
function repeated(between = '', body = 'S += A J') {
    return `use sequences
A = array 1 2 3
S = 0
for Outer in 0 to 3
 for I in 0 to 2
  for J in 0 to I
   ${body}
  end
 end
 ${between}
 Scratch = tuple Outer
end`;
}

describe('revision-guarded Number loop read buffers', () => {
    it('prepares an unchanged nested-loop input once', () => {
        const { diagnostics, state } = compare(repeated());
        expect(state.variables).toContainEqual(['S', '40']);
        expect(diagnostics.numberLoops).toBe(4);
        expect(diagnostics.numberLoopReadBuffers).toBe(1);
        expect(diagnostics.numberLoopReadBufferCells).toBe(3);
        expect(diagnostics.numberLoopReadBufferHits).toBe(3);
    });

    it.each([
        'A 0 += 10',
        'A = (A + 1) array',
        'Alias = A\nA 0 += 10',
    ])('refreshes snapshots after a store or rebinding: %s', between => {
        const { diagnostics } = compare(repeated(between));
        expect(diagnostics.numberLoopReadBuffers).toBe(4);
        expect(diagnostics.numberLoopReadBufferHits).toBe(0);
    });

    it('rechecks safe integer conversion after a cached input changes', () => {
        const { diagnostics, state } = compare(repeated('A 1 = 9007199254740992'));
        expect(state.variables).toContainEqual(['S', '54043195528445980']);
        expect(diagnostics.numberLoopReadBuffers).toBe(1);
        expect(diagnostics.fallbacks['number-loop:unsafe-cell']).toBeGreaterThan(0);
    });

    it('retains private replay after arithmetic overflow with a cached input', () => {
        const { diagnostics } = compare(repeated('S = 9007199254740990'));
        expect(diagnostics.numberLoopReadBufferHits).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('publishes preceding progress on a bounds error after a cache hit', () => {
        const { diagnostics, state } = compare(repeated('', 'S += A (J + Outer)'));
        expect(state.error).toContain('out of bounds');
        expect(diagnostics.numberLoopReadBufferHits).toBe(1);
    });

    it('keeps an aliased read snapshot separate from private destination writes', () => {
        const { state, diagnostics } = compare(`A = array 1 2 3
B = A
S = 0
for Outer in 0 to 3
 for I in 0 to 2
  for J in 0 to I
   S += A J
   B J += 1
  end
 end
 Scratch = tuple Outer
end`);
        expect(state.variables).toContainEqual(['A', '1 2 3']);
        expect(state.variables).toContainEqual(['B', '13 10 7']);
        expect(diagnostics.numberLoopReadBufferHits).toBe(3);
    });

    it.each([
        repeated('', 'S += A J').replace('array 1 2 3', 'array 1.5 2.5 3.5').replace('S = 0', 'S = 0.0'),
        repeated('', 'if A J\n S += 1\nend').replace('array 1 2 3', 'array true false true'),
        repeated('A 0 0 += 1', 'S += A 0 J').replace('A = array 1 2 3', 'A = (array 1 2 3) reshape 1 3'),
    ])('retains real, boolean and matrix cell contracts: %s', source => {
        expect(compare(source).diagnostics.numberLoops).toBe(4);
    });
});
