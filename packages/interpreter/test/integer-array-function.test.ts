import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isNativeFunction } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';
import { withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { answerOf } from './support.js';

type Scope = (run: () => void) => void;
function execute(source: string, options: InterpreterOptions = {}, scope: Scope = run => run()) {
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined, value: string | undefined;
    try {
        try { scope(() => diagnostics.run(() => { const result = runtime.execute(source); value = result === undefined ? undefined : formatValue(result); })); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error, value, output,
            variables: [...runtime.variables].map(([name, item]) => [name, formatValue(item)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, scope?: Scope) {
    const result = execute(source, {}, scope);
    expect(result.observation).toEqual(execute(source, { compilation: false }, scope).observation);
    expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }, scope).observation);
    return result;
}
const transform = `fun A B transformed Mod
 Product = A * B mod Mod
 return Product + 1
end
A = array 1 2 3
B = array 7
Result = array 0
Total = 0
for I in 1 to 2
 Result = A B transformed 100000000
 Total += Result sum
end`;

describe('pure integer array helpers in Number loops', () => {
    it('honors the function compilation switch', () => {
        const result = execute(transform, { scalarFunctionCompilation: false });
        expect(result.observation).toEqual(execute(transform, { compilation: false }).observation);
        expect(result.diagnostics.numberLoops).toBe(0);
    });
    it('declines the fresh array ABI when the host replaces the call method', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        try {
            runtime.execute(`fun A doubled
 return A * 2
end
A = array 1 2 3`);
            const fn = runtime.variables.get('doubled');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing helper');
            const original = fn.call;
            Object.defineProperty(fn, 'call', { value: (args: Parameters<typeof original>[0]) => {
                return original(args);
            } });
            const diagnostics = new RuntimeDiagnostics();
            diagnostics.run(() => runtime.execute(`Total = 0
for I in 1 to 2
 B = A doubled
 Total += B sum
end`));
            expect(runtime.variables.get('Total')).toBe(24n);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each(['columnNames', 'tableScopes', 'sortKeys'])('keeps %s on the ordinary array path', key => {
        const observations = [true, false].map(compilation => {
            const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.execute(`fun A doubled
 return A * 2
end
A = array 1 2 3`);
                Object.defineProperty(runtime.variables.get('A')!, key, { value: [] });
                let error: string | undefined;
                try { diagnostics.run(() => runtime.execute(`Total = 0
for I in 1 to 2
 B = A doubled
 Total += B sum
end`)); }
                catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
                expect(diagnostics.numberLoops).toBe(0);
                return { error, total: runtime.variables.get('Total'), result: runtime.variables.get('B') };
            } finally { runtime.dispose(); }
        });
        expect(observations[0]).toEqual(observations[1]);
    });
    it('composes staged arithmetic, scalar parameters and singleton broadcasting', () => {
        const { diagnostics, observation } = compare(transform);
        expect(observation.error).toBeUndefined();
        expect(observation.variables).toContainEqual(['Result', '8 15 22']);
        expect(observation.variables).toContainEqual(['Total', '90']);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });
    it('returns fresh values while preserving caller aliases and later mutations', () => {
        const { observation, diagnostics } = compare(`${transform}
Saved = Result
Result 0 = 99
A 0 = 10`);
        expect(observation.error).toBeUndefined();
        expect(observation.variables).toContainEqual(['Saved', '8 15 22']);
        expect(observation.variables).toContainEqual(['Result', '99 15 22']);
        expect(diagnostics.numberLoops).toBe(1);
    });
    it.each([
        ['array shape 0 fill 0', 'array 7'],
        ['array 1', 'array shape 0 fill 0'],
        ['array 1 2', 'array 3 4 5'],
    ])('retains empty and incompatible shape behavior: %s / %s', (a, b) => {
        compare(transform.replace('A = array 1 2 3', `A = ${a}`).replace('B = array 7', `B = ${b}`));
    });
    it.each([3, -3])('preserves floor division and signed remainder with divisor %s', divisor => {
        const result = compare(`fun A computed D
 Q = A // D
 return Q + A mod D
end
A = array -9007199254740991 -11 -1 0 11 9007199254740991
Total = 0
for I in 1 to 2
 B = A computed ${divisor}
 Total += B sum
end`);
        expect(result.observation.error).toBeUndefined();
    });
    it('uses exact modular products beyond safe Number multiplication', () => {
        const result = compare(transform.replace('A = array 1 2 3', 'A = array 99999999 9007199254740991 9007199254740990').replace('B = array 7', 'B = array 99999999'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });
    it.each(['0', '-7', '1073741825'])('retains exact fallback for modulus %s', modulus => {
        compare(transform.replace('transformed 100000000', `transformed ${modulus}`));
    });
    it('replays wide result cells without duplicating caller stores', () => {
        const result = compare(`fun A widened
 return A + 9007199254740991
end
A = array 0 1
Count = 0
Total = 0
for I in 1 to 2
 Count += 1
 B = A widened
 Total += B 0
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Count', '2']);
        expect(result.observation.variables).toContainEqual(['Total', '18014398509481982']);
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });
    it('preserves array-binding errors before an unselected read', () => {
        const result = compare(`fun A divided B
 return A // B
end
A = array 10 20
B = array 2 0
Total = 0
for I in 1 to 2
 Values = A divided B
 Total += Values 0
end`);
        
        expect(result.observation.error).toContain('zero');
        expect(result.observation.variables).toContainEqual(['Total', '0']);
    });
    it('preserves the selected error and previously completed caller stores', () => {
        const result = compare(`fun A divided B
 return A // B
end
A = array 10 20
B = array 2 0
Count = 0
Total = 0
for I in 0 to 1
 Count += 1
 Values = A divided B
 Total += Values I
end`);
        expect(result.observation.error).toContain('zero');
        expect(result.observation.variables).toContainEqual(['Count', '1']);
        expect(result.observation.variables).toContainEqual(['Total', '0']);
    });
    it.each(['Bad = 1 // 0', 'Bad = A // 0'])('retains unused binding semantics: %s', binding => {
        compare(`fun A changed
 ${binding}
 return A * 2
end
A = array 1 2
Total = 0
for I in 1 to 2
 B = A changed
 Total += B sum
end`);
    });
    it('does not broadcast an unused array argument into the result', () => {
        const result = compare(`fun A changed B
 return A * 2
end
A = array 1 2
B = array 1 2 3
Total = 0
for I in 1 to 2
 C = A changed B
 Total += C sum
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Total', '12']);
        expect(result.diagnostics.numberLoops).toBe(1);
    });
    it('rechecks a rebound helper across repeated caller invocations', () => {
        const result = compare(`fun A doubled
 return A * 2
end
fun A tripled
 return A * 3
end
op = doubled
fun A calculate
 Total = 0
 for I in 1 to 2
  B = A op
  Total += B sum
 end
 return Total
end
A = array 1 2
First = A calculate
op = tripled
Second = A calculate`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['First', '12']);
        expect(result.observation.variables).toContainEqual(['Second', '18']);
    });
    it.each([1, 100000])('retains demand guards at budget %s', budget => {
        const result = execute(transform, {}, run => withDemandBudget(budget, run));
        if (budget === 1) expect(result.observation.error).toContain('demand budget exhausted');
        else expect(result.observation).toEqual(execute(transform, { compilation: false }).observation);
    });
    it('preserves caller array stores and aliases when a cell overflows', () => {
        const result = compare(`fun A widened
 return A + 9007199254740991
end
A = array 0 1
Saved = A
Count = 0
for I in 1 to 2
 A 0 += 1
 Count += 1
 B = A widened
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['A', '2 1']);
        expect(result.observation.variables).toContainEqual(['Saved', '0 1']);
        expect(result.observation.variables).toContainEqual(['Count', '2']);
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });
    it('retains unused deferred binding demand', () => {
        const result = compare(`fun A changed
 Bad' = A // 0
 return A * 2
end
A = array 1 2
Total = 0
for I in 1 to 2
 B = A changed
 Total += B sum
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Total', '12']);
    });
    it('upgrades guarded caller executions to ordinary Number execution', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        try {
            runtime.execute(`use sequences
fun A doubled
 return A * 2
end
fun A calculate
 Total = 0
 for I in 1 to 2
  B = A doubled
  Total += B sum
 end
 return Total
end
A = 0 to 4096 copy`);
            const invoke = () => runtime.execute('Answer = A calculate');
            const signal = new Int32Array(new SharedArrayBuffer(12));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, invoke)).toThrow();
            Atomics.store(signal, 0, 0);
            withInterrupt(signal, invoke);
            expect(answerOf(runtime)).toBe(33562624n);
            expect(() => withDemandBudget(1, invoke)).toThrow('demand budget exhausted');
            invoke();
            expect(answerOf(runtime)).toBe(33562624n);
            invoke();
            expect(answerOf(runtime)).toBe(33562624n);
        } finally { runtime.dispose(); }
    });
    it('retains observable interruption boundaries', () => {
        compare(transform, run => {
            let polls = 0;
            const signal: InterruptSignal = { length: 1, load: () => ++polls > 25 ? 1 : 0,
                store() {}, exchange: () => 0, wait() {} };
            withInterrupt(signal, run);
        });
    });
});
