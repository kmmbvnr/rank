import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

type Scope = (run: () => void) => void;
function execute(source: string, options: InterpreterOptions = {}, scope: Scope = run => run()) {
    let code = '';
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false,
        onIntegerLoopCompiled: source => { code = source; }, ...options });
    let error: string | undefined, value: string | undefined;
    try {
        try { scope(() => diagnostics.run(() => {
            const result = runtime.execute(source);
            value = result === undefined ? undefined : formatValue(result);
        })); }
        catch (failure) {
            error = failure instanceof RankError ? failure.format() : String(failure);
        }
        return { code, diagnostics, observation: { error, value,
            values: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, scope?: Scope) {
    const result = execute(source, {}, scope);
    expect(result.observation).toEqual(execute(source, { compilation: false }, scope).observation);
    expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }, scope).observation);
    return result;
}
const stores = `A = array 0
Alias = A
Count = 0
for Pass in 1 to 2
 A = array shape 3 fill 0
 Alias = A
 for I in 0 till 3
  Count += 1
  A I += Pass
 end
end`;

describe('ownership-only nested arithmetic loops', () => {
    it('keeps stores inline while retaining COW snapshots', () => {
        const result = compare(stores);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.code).not.toContain('function traversal');
        expect(result.code).not.toMatch(/const frame\d+ =/);
        expect(result.observation.values).toContainEqual(['A', '2 2 2']);
        expect(result.observation.values).toContainEqual(['Alias', '0 0 0']);
        expect(result.observation.values).toContainEqual(['Count', '6']);
    });
    it.each(['0 till 0', '2 to 0 by -1'])('preserves %s traversal and loop results', range => {
        const result = compare(stores.replace('0 till 3', range));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('publishes completed stores and counters before an indexed error', () => {
        const result = compare(stores.replace('0 till 3', '0 to 3'));
        expect(result.observation.error).toContain('out of bounds');
        expect(result.observation.values).toContainEqual(['A', '1 1 1']);
        expect(result.observation.values).toContainEqual(['Alias', '0 0 0']);
        expect(result.observation.values).toContainEqual(['Count', '4']);
    });
    it('replays overflow without duplicating writes or changing aliases', () => {
        const result = compare(stores.replace('A I += Pass', 'A I = 9007199254740991 + I'));
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.values).toContainEqual(['A', '9007199254740991 9007199254740992 9007199254740993']);
        expect(result.observation.values).toContainEqual(['Count', '6']);
        expect(result.observation.values).toContainEqual(['Alias', '0 0 0']);
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });
    it('retains persistent traversals for native calls', () => {
        const result = compare(`use numbers
A = array 0 0 0
for Pass in 1 to 2
 for I in 0 till 3
  A I = (I + Pass) gcd 6
 end
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.code).toContain('function traversal');
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.observation.values).toContainEqual(['A', '2 3 2']);
    });
    it.each([1, 1000])('preserves demand guards at budget %s', budget => {
        const result = execute(stores, {}, run => withDemandBudget(budget, run));
        if (budget === 1) expect(result.observation.error).toContain('demand budget exhausted');
        else expect(result.observation).toEqual(execute(stores, { compilation: false }).observation);
    });
    it('retains observable interrupt boundaries', () => {
        compare(stores, run => {
            let polls = 0;
            const signal: InterruptSignal = { length: 1, load: () => ++polls > 25 ? 1 : 0,
                store() {}, exchange: () => 0, wait() {} };
            withInterrupt(signal, run);
        });
    });
});
