import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget, withInterrupt, InterruptedError, type InterruptSignal } from '../src/interrupt.js';

type Scope = (run: () => void) => void;
function execute(source: string, options: InterpreterOptions = {}, scope: Scope = run => run()) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options }), diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { scope(() => diagnostics.run(() => runtime.execute(source))); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, scope?: Scope) {
    const result = execute(source, {}, scope);
    expect(result.observation).toEqual(execute(source, { compilation: false }, scope).observation);
    expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }, scope).observation);
    return result;
}
const source = (base: string, exponent: string, modulus: string) => `use numbers
fun B E raised M
 return B E M powmod
end
Total = 0
for I in 1 to 3
 Total += ${base} ${exponent} raised ${modulus}
end`;
describe('powmod in compiled numeric scalar functions', () => {
    it.each([
        ['10', '1234567', '100000000'], ['-17', '4294967297', '1073741824'],
        ['9007199254740991', '9007199254740991', '999999937'], ['0', '0', '1'],
        ['2', '100', '1073741825'], ['9007199254740993', '40', '97'],
        ['2', '-1', '7'], ['2', '10', '0'], ['2', '10', '-7'],
    ])('matches exact evaluation for %s ^ %s mod %s', (base, exponent, modulus) => {
        compare(source(base, exponent, modulus));
    });
    it('runs integer powmod helpers in Number mode', () => {
        const result = compare(source('10', '123', '97'));
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
    });
    it('replays caller writes and the original error boundary', () => {
        const result = compare(`use numbers
fun B E raised M
 return B E M powmod
end
A = array 0
Total = 0
for I in 1 to 3
 A 0 += 1
 Mod = 7
 if I equal 2
  Mod = 0
 end
 Total += 2 I raised Mod
end`);
        expect(result.observation.error).toContain('powmod modulus must be positive');
        expect(result.observation.variables).toContainEqual(['A', '2']);
    });
    it('retains the native builtin redefinition error', () => {
        const result = compare(`use numbers
fun B E raised M
 return B E M powmod
end
fun B E M powmod = B + E + M
Total = 0
for I in 1 to 3
 Total += 2 I raised 7
end`);
        expect(result.observation.error).toContain('cannot redefine available builtin: powmod');
    });
    it.each([1, 1000])('retains guarded function demand at %s', budget => {
        const observe = (compilation: boolean) => {
            const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
            try {
                runtime.execute(`use numbers
fun B E raised M
 return B E M powmod
end`);
                // The shared native cache has its own existing work cadence;
                // compare the two engines with the same warmed power table.
                runtime.execute('10 123 97 powmod');
                let error: string | undefined;
                try { withDemandBudget(budget, () => runtime.execute('Answer = 10 123 raised 97')); }
                catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
                return { error, answer: runtime.variables.get('Answer') };
            } finally { runtime.dispose(); }
        };
        expect(observe(true)).toEqual(observe(false));
    });
    it('retains custom polling and cancellation', () => {
        compare(source('10', '4294967297', '97'), run => {
            let exchanges = 0;
            const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {},
                exchange: () => ++exchanges >= 2 ? 1 : 0 };
            withInterrupt(signal, run);
        });
    });
    it('keeps atomic cancellation after a cached ordinary call', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        try {
            runtime.execute(`use numbers
fun B E raised M
 return B E M powmod
end
Answer = 10 1000000000000 raised 97`);
            const before = runtime.variables.get('Answer');
            const signal = new Int32Array(new SharedArrayBuffer(12));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => runtime.execute('Answer = 10 1000000000000 raised 97'))).toThrow(InterruptedError);
            expect(runtime.variables.get('Answer')).toBe(before);
        } finally { runtime.dispose(); }
    });
    it('retains nested leaf hooks and the call-depth limit', () => {
        const program = `fun A B leaf C = A + B * C
fun X middle
 Mid = X 2 leaf 3
 return Mid + 1
end
fun X outer
 Result = X middle
 return Result + 1
end
Total = 0
for I in 1 to 3
 Total += I outer
end`;
        compare(program);
        const limited = execute(program, { maxCallDepth: 2 });
        expect(limited.observation.error).toContain('function call depth exceeds 2');
        expect(execute(program, { maxCallDepth: 2, compilation: false }).observation.error).toContain('function call depth exceeds 2');
        expect(limited.observation.variables).toContainEqual(['Total', '0']);
        let calls = 0;
        const hooked = execute(program, { onScalarFunctionExecuted: () => calls++ });
        expect(hooked.observation.error).toBeUndefined();
        expect(calls).toBeGreaterThan(0);
    });
    it.each([3, 4])('retains numeric leaf calls with %s parameters', arity => {
        const parameters = arity === 3 ? 'A B leaf C' : 'A B leaf C D';
        const result = compare(`fun ${parameters} = A + B * C${arity === 4 ? ' + D' : ''}
Total = 0
for I in 1 to 3
 Total += I 2 leaf 3${arity === 4 ? ' 4' : ''}
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Total', arity === 3 ? '24' : '36']);
        expect(result.diagnostics.numberLoops).toBe(1);
    });
});
