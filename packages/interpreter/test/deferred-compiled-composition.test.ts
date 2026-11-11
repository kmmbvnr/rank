import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { isRankPlan } from '../src/plan.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';

function run(source: string, compilation: boolean) {
    const output: string[] = [];
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    const runtime = new Interpreter(text => output.push(text), { compilation, scalarEntryCompilation: false });
    try {
        let value: string | undefined, error: string | undefined;
        diagnostics.run(() => {
            try {
                const result = runtime.execute(source);
                if (result !== undefined) value = formatValue(result);
            } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        });
        // Inspect the binding kind without demanding a retained recipe.
        const bindings = [...runtime.variables].filter(([name]) => /^[A-Z]/.test(name))
            .map(([name, value]) => [name, isRankPlan(value) ? 'plan' : formatValue(value)]);
        return { observation: { value, error, output, bindings }, diagnostics };
    } finally { runtime.dispose(); }
}

const loops = [
    ['scalar recipe', `Total = 0
for I in 1 to 3
 Value' = I * 2
 Total += Value
end
Total`, '12'],
    ['recipe rebinding', `Total = 0
for I in 1 to 3
 Value' = I * 2
 First = Value
 Value' = I * 3
 Total += First + Value
end
Total`, '30'],
    ['deferred argument', `fun X' twice
 return X + X
end
Total = 0
for I in 1 to 3
 Value' = I * 2
 Total += Value twice
end
Total`, '24'],
    ['stored and deferred rebinding', `Total = 0
for I in 1 to 3
 Value' = I * 2
 Value = I * 2 + 1
 Total += Value
 Value' = I * 3
 Total += Value
end
Total`, '33'],
    ['branch-local recipe', `Total = 0
for I in 1 to 3
 if I greater 1
  Value' = I * 2
  Total += Value
 else
  Value' = I * 3
  Total += Value
 end
end
Total`, '13'],
    ['continue and break', `Total = 0
for I in 1 to 5
 Value' = I * 2
 if I equal 2
  continue
 end
 if I equal 4
  break
 end
 Total += Value
end
Total`, '8'],
    ['nested recipes', `Total = 0
for I in 1 to 3
 First' = I + 1
 Second' = First * 2
 Total += Second
end
Total`, '18'],
    ['wide integer demand', `Total = 0
for I in 1 to 3
 Value' = (2 ** 80) + I
 Total += Value
end
Total`, '3626777458843887524118534'],
    ['boolean demand', `Total = 0
for I in 1 to 3
 Value' = I greater 1
 if Value
  Total += I
 end
end
Total`, '5'],
    ['real demand', `Total = 0.0
for I in 1 to 3
 Value' = I * 1.5
 Total += Value
end
Total`, '9'],
    ['captured scalar rebinding', `Total = 0
for I in 1 to 3
 Source = I
 Value' = Source * 2
 Source = 100
 Total += Value
end
Total`, '12'],
    ['unused failing recipe', `Total = 0
for I in 1 to 3
 Unused' = I // 0
 Total += I
end
Total`, '6'],
] as const;

describe('compiled deferred composition', () => {
    it('rejects changing an established deferred result type', () => {
        const source = `for I in 1 to 3
 Value' = I * 2
 First = Value
 Value' = true
 Last = Value
end`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.error).toBeDefined();
    });

    it('preserves the error for compound assignment to a plan', () => {
        const source = `for I in 1 to 3
 Value' = I * 2
 Value += 1
end`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.error).toBeDefined();
    });
    it.each(loops)('keeps generated loop control for %s', (name, source, value) => {
        const reference = run(source, false), candidate = run(source, true);
        expect(candidate.observation).toEqual(reference.observation);
        expect(candidate.observation.error).toBeUndefined();
        expect(candidate.observation.value).toBe(value);
        if (name === 'deferred argument') {
            const paths = candidate.diagnostics.compilerObservations.flatMap(entry => entry.execution?.paths ?? []);
            expect(paths).toContain('value-block');
        } else expect(candidate.diagnostics.compiledLoops).toBeGreaterThan(0);
    });

    it.each([
        ['distinct escaped environments', `fun N make
 First' = N + 1
 Second' = First * 2
 return Second
end
Left' = 1 make
Right' = 3 make
First = Left
Second = Right
tuple First Second`, '4 8'],
        ['nested deferred helpers', `fun X' leaf
 return X + X
end
fun X' middle
 Result' = X leaf
 return Result
end
fun N outer
 Value' = N + 1
 return Value middle
end
Left' = 1 outer
Right' = 3 outer
First = Left
Second = Right
tuple First Second`, '4 8'],
        ['array result snapshots', `fun Input make
 Values' = Input * 2
 return Values
end
Source = array 1 2 3
Alias = Source
Result' = Source make
Alias 0 = 9
First = Result
Second = Result
tuple (First 0) (Second 0) (Alias 0)`, '2 2 9'],
    ])('retains generated function control for %s', (_name, source, expected) => {
        const candidate = run(source, true);
        expect(candidate.observation).toEqual(run(source, false).observation);
        expect(candidate.observation.error).toBeUndefined();
        expect(candidate.observation.value).toBe(expected);
        const paths = candidate.diagnostics.compilerObservations.flatMap(entry => entry.execution?.paths ?? []);
        expect(paths).toContain('framed-function');
    });

    it.each([false, true])('publishes a coherent prefix on cancellation (compilation=%s)', compilation => {
        let polls = 0;
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {},
            exchange: () => ++polls > 2 ? 1 : 0, wait() {} };
        const runtime = withInterrupt(signal, () => new Interpreter(undefined, { compilation, scalarEntryCompilation: false }));
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('Total = 0');
            expect(() => diagnostics.run(() => withInterrupt(signal, () => runtime.execute(`for I in 1 to 2000
 Value' = I * 2
 Total += Value
end`)))).toThrow(InterruptedError);
            const total = runtime.variables.get('Total') as bigint;
            const count = BigInt(Math.floor((Math.sqrt(1 + 4 * Number(total)) - 1) / 2));
            expect(total).toBeGreaterThan(0n);
            expect(total).toBe(count * (count + 1n));
            if (compilation) expect(diagnostics.compiledLoops).toBe(1);
            expect(runtime.execute(`Total = 0
for I in 1 to 3
 Value' = I * 2
 Total += Value
end
Total`)).toBe(12n);
        } finally { runtime.dispose(); }
    });

    it('keeps demand failures after earlier effects', () => {
        const source = `use io
Total = 0
for I in 1 to 3
 Bad' = I // 0
 I print
 Total += Bad
end`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.output).toEqual(['1']);
        expect(result.observation.error).toContain('division by zero');
    });

    it('preserves return calls from a loop with deferred locals', () => {
        const source = `fun N descend
 if N equal 0
  return 7
 end
 for I in 1 to 1
  Unused' = N * 2
  return (N - 1) descend
 end
 return 0
end
20 descend`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.value).toBe('7');
        expect(result.diagnostics.compiledLoops).toBeGreaterThan(0);
    });

    it.each(['Value', 'Value * 2'])('keeps loop-returned %s deferred', expression => {
        const source = `fun N make
 for I in 1 to N
  Value' = I * 2
  if I equal 2
   return ${expression}
  end
 end
 return 0
end
Saved' = 3 make
Saved`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.value).toBe(expression === 'Value' ? '4' : '8');
        expect(result.observation.bindings).toContainEqual(['Saved', 'plan']);
    });

    it.each([false, true])('preserves escaped branch recipes (compilation=%s)', compilation => {
        const source = `fun N make
 if N greater 0
  Value' = N * 2
  return Value
 else
  Value' = N - 1
  return Value
 end
end
Saved' = 3 make
Saved`;
        const result = run(source, compilation);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.value).toBe('6');
        expect(result.observation.bindings).toContainEqual(['Saved', 'plan']);
    });

    it.each([false, true])('stages helper effects once when constructing a recipe (compilation=%s)', compilation => {
        const source = `use io
fun N announce
 N print
 return N + 1
end
Value' = (3 announce) * 2
First = Value
Second = Value
tuple First Second`;
        const result = run(source, compilation);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.output).toEqual(['3']);
        expect(result.observation.value).toBe('8 8');
    });
});
