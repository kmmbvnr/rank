import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

function execute(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
    try {
        let result: string | undefined, error: string | undefined;
        try { const value = diagnostics.run(() => runtime.execute(source)); result = value === undefined ? undefined : formatValue(value); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { result, error, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
const growing = (real: boolean) => `use sequences
A = array ${real ? '0.0' : '0'}
B = A
Saved = A
Total = ${real ? '0.0' : '0'}
for I in 1 to 256
 A = (1 to I copy) * ${real ? '0.5' : '1'}
 if I equal 17
  Saved = A
 end
 A 0 = ${real ? '-7.0' : '-7'}
 B = A * 3
 Total += B sum
end
tuple Saved A B Total`;

describe('private vector scratch capacity', () => {
    it.each([false, true])('amortizes gradual growth and retains aliased snapshots (real=%s)', real => {
        const source = growing(real), result = execute(source);
        expect(result.observation).toEqual(execute(source, false).observation);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        const cost = result.diagnostics.costs['number-loop.vector-buffer'];
        expect(cost.calls).toBeLessThan(100);
        expect(cost.allocatedBytes).toBeLessThan(65536);
    });
    it('reuses fixed-size scratch rather than growing it per iteration', () => {
        const source = `use sequences
A = array 0
B = A
Total = 0
for I in 1 to 256
 A = 1 to 32 copy
 B = A * I
 Total += B sum
end
tuple A B Total`;
        const result = execute(source);
        expect(result.observation).toEqual(execute(source, false).observation);
        expect(result.diagnostics.costs['number-loop.vector-buffer'].allocatedBytes).toBeLessThan(2048);
    });
    it.each(['A (1 till I) = A (0 till I - 1)', 'A 0 = 2147483648'])('retains overlapping writes/widening during growth: %s', write => {
        const source = growing(false).replace(' A 0 = -7', ` ${write}`);
        const result = execute(source);
        expect(result.observation).toEqual(execute(source, false).observation);
    });
    it('keeps completed state and diagnostics when an oversized selector fails', () => {
        const source = growing(false).replace(' B = A * 3', ' if I equal 33\n  A (0 to I) = 1\n end\n B = A * 3');
        expect(execute(source).observation).toEqual(execute(source, false).observation);
    });
});
