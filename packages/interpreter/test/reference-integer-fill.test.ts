import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';

function execute(source: string, cells = false) {
    const runtime = new Interpreter(() => {}, { compilation: false });
    const diagnostics = new RuntimeDiagnostics();
    const run = () => diagnostics.run(() => runtime.execute(source));
    let result: string | undefined, error: string | undefined;
    try {
        try {
            // Arbitrary host polling keeps the ordinary per-cell writer. The
            // no-op signal gives an independent oracle without a new option.
            const value = cells ? withInterrupt({ length: 1, load: () => 0,
                store: () => {}, exchange: () => 0, wait: () => {} }, run) : run();
            if (value !== undefined) result = formatValue(value);
        } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { state: { result, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) }, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const actual = execute(source), ordinary = execute(source, true);
    expect(actual.state).toEqual(ordinary.state);
    expect(ordinary.diagnostics.bulkArrayWrites).toBe(0);
    expect(actual.diagnostics.compiledLoops).toBe(0);
    return actual;
}

describe('native scalar integer fills without compilation', () => {
    it.each([
        'A (0 to 5 by 2) = 9',
        'A (5 to 1 by -2) = -9',
        'A (0 till 6) = A 0',
        'A (0 to 5) = 3000000000',
        'A (0 to 5) = -9223372036854775809',
        'A (0 to 5) = 9223372036854775808',
    ])('uses the primitive and preserves aliases: %s', statement => {
        const result = compare(`A = array 1 2 3 4 5 6
Alias = A
Cut = A (1 to 3)
${statement}`);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.bulkArrayWrites).toBe(1);
    });

    it('handles scalar prefixes of higher-rank arrays', () => {
        const result = compare(`A = array shape 2 2 4 fill 0
A 1 0 (3 to 1 by -1) = 7`);
        expect(result.diagnostics.bulkArrayWrites).toBe(1);
    });

    it.each([
        'A (99 till 0) = 1 // 0',
        'A (0 to 6) = 1 // 0',
        'A (0 to 5 by 0) = 1 // 0',
        'A (0 to 5) = 1 // 0',
        'A (99 till 0) = 7',
        'A (0 to 5) = 7\nS = 1 // 0',
    ])('preserves selection errors, empty writes and preceding state: %s', statement => {
        compare(`A = array 1 2 3 4 5 6
S = 1
${statement}`);
    });

    it.each([
        'A (0 to 5) += 2',
        'A (0 to 5) = A (5 to 0 by -1)',
        'A (array 0 0 2) = 2',
        'A (array 0 0 2) += 2 .accumulate',
    ])('retains ordinary compound, vector and indirect paths: %s', statement => {
        const result = compare(`A = array 1 2 3 4 5 6
${statement}`);
        expect(result.diagnostics.bulkArrayWrites).toBe(0);
    });

    it('cooperatively cancels a long fill and runs finally', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        const flag = new Int32Array([1]);
        try {
            runtime.execute('A = array shape 100000 fill 0\nDone = 0');
            expect(() => withInterrupt(flag, () => runtime.execute(`try
 A (0 till 100000) = 1
finally
 Done = 1
end`))).toThrow('Interrupted');
            expect(runtime.variables.get('Done')).toBe(1n);
        } finally { runtime.dispose(); }
    });
});
