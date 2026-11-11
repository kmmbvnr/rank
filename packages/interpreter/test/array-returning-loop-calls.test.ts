import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

import { readArrayItem } from '../src/array-storage.js';
import { withInterrupt, InterruptedError, type InterruptSignal } from '../src/interrupt.js';

function run(source: string, compilation = true) {
    let loops = 0;
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, {
        compilation, scalarEntryCompilation: false, onIntegerLoopExecuted: () => loops++,
    });
    try {
        let value: string | undefined, error: string | undefined;
        try { const result = diagnostics.run(() => runtime.execute(source)); if (result !== undefined) value = formatValue(result); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { loops, diagnostics, observation: { value, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]),
        } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const candidate = run(source);
    expect(candidate.observation).toEqual(run(source, false).observation);
    return candidate;
}

describe('array-returning calls in compiled loops', () => {
    it('binds a fresh result on each iteration and reads it in the region', () => {
        const result = compare(`fun N row
 return array shape N fill N
end
Total = 0
for I in 1 to 3
 Current = I row
 Total += Current 0
end
Total`);
        expect(result.observation.value).toBe('6');
        expect(result.loops).toBe(1);
    });

    it('replaces an array input while a BigInt binary loop runs', () => {
        const result = compare(`fun A nextrow N
 return array shape 2 fill (A 0) + N
end
A = array 0 0
N = 2 ** 80
for N greater 0
 A = A nextrow N
 N //= 2
end
A 0`);
        expect(result.observation.value).toBe(String(2n ** 81n - 1n));
        expect(result.loops).toBe(1);
    });

    it('preserves a callee parameter and its returned copy after local writes', () => {
        const result = compare(`fun A changed N
 A 0 = N
 return A
end
Source = array 10 20
Current = Source
Total = 0
for I in 1 to 3
 Current = Source changed I
 Total += (Current 0) + (Source 0)
end
tuple Total Source Current`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('compiles caller writes while preserving the returned alias', () => {
        const result = compare(`fun A pass
 return A
end
Source = array 1 2
Saved = Source
for I in 1 to 2
 Saved = Source pass
 Source 0 = I + 10
end
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it.each(['A', 'array 7 8', 'A (0 to 1)'])(
        'protects returned %s while writing both bindings', returned => {
            const result = compare(`fun A row
 return ${returned}
end
Source = array 1 2
Saved = Source
for I in 1 to 3
 Saved = Source row
 Saved 1 += I
 Source 0 += I
end
tuple Saved Source`);
            expect(result.observation.error).toBeUndefined();
            expect(result.loops).toBe(1);
        });

    it('publishes preceding writes when a later store fails', () => {
        const result = compare(`fun A pass
 return A
end
Source = array 1 2
Saved = Source
for I in 0 to 2
 Saved = Source pass
 Source 0 += 10
 Source I += 1
end
tuple Saved Source`);
        expect(result.observation.error).toContain('out of bounds');
        expect(result.loops).toBe(1);
    });

    it('retains snapshots pushed before each source write', () => {
        const result = compare(`use algo
Source = array 1 2
Saved = Source
Queue = new queue
for I in 1 to 3
 Queue push Source
 Source 0 += I
end
Saved = Queue pop
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it.each(['break', 'continue'])('preserves snapshots across %s', control => {
        const result = compare(`fun A pass
 return A
end
Source = array 1 2
Saved = Source
for I in 1 to 3
 Saved = Source pass
 Source 0 += I
 if I equal 2
  ${control}
 end
 Source 1 += I
end
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('uses current bindings after repeated deque extraction and writes', () => {
        const result = compare(`use algo
Source = array 1 2
Saved = Source
Queue = new queue
Queue push Source
for I in 1 to 3
 Saved = Queue pop
 Saved 0 += I
 Queue push Saved
 Saved 1 += I
end
Source = Queue pop
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('reads the detached binding when a self-selection escapes a store', () => {
        const result = compare(`fun A pass
 return A
end
Source = array 1 2 3
Saved = Source
for I in 1 to 2
 Saved = Source pass
 Source 0 += I
 Source (0 to 1) = Source (1 to 2)
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('copies a shared source only at its first store after each call', () => {
        const result = compare(`fun A pass
 return A
end
Source = array shape 1000 fill 0
Saved = Source
for I in 1 to 3
 Saved = Source pass
 Source 0 += I
 Source 1 += I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
        expect(result.diagnostics.cowCopies).toBe(3);
        expect(result.diagnostics.cowCopiedCells).toBe(3000);
    });

    it('does not copy a fresh callee result before writing it', () => {
        const result = compare(`fun N row
 return array shape 1000 fill N
end
for I in 1 to 3
 Current = I row
 Current 0 += I
 Current 1 += I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
        expect(result.diagnostics.cowCopies).toBe(0);
    });

    it.each(['# 0', '0 #', '(array 0 1) 0', '(array true false) 0'])(
        'preserves matrix aliases across selection %s', selection => {
            const result = compare(`fun A pass
 return A
end
Source = array shape 2 2 fill 0
Saved = Source
for I in 1 to 3
 Saved = Source pass
 Source ${selection} += I
end
tuple Saved Source`);
            expect(result.observation.error).toBeUndefined();
            expect(result.loops).toBe(1);
        });

    it.each(['(array 0 2)', '(array true false true)', '(0 to 2 by 2)'])(
        'protects vector aliases across selector %s', selection => {
            const result = compare(`fun A pass
 return A
end
Source = array 1 2 3
Saved = Source
for I in 1 to 3
 Saved = Source pass
 Source ${selection} += I
end
tuple Saved Source`);
            expect(result.observation.error).toBeUndefined();
            expect(result.loops).toBe(1);
        });

    it.each(['', 'if I equal 2\n  break\n end'])('publishes array permutations with calls and control: %s', control => {
        const result = compare(`fun A pass
 return A
end
First = array 1 2
Second = array 3 4
Saved = First
for I in 1 to 3
 Saved = First pass
 First 0 += I
 unpack First Second = tuple Second First
 ${control}
 Second 1 += I
end
tuple First Second Saved`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('retains a short returned slice without copying the full source', () => {
        const result = compare(`fun A edge
 return A (0 to 1)
end
Source = array shape 1000 fill 0
Saved = array 0 0
for I in 1 to 3
 Saved = Source edge
 Source 0 += I
end
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
        expect(result.diagnostics.cowCopiedCells).toBe(0);
        expect(result.diagnostics.costs['array.copy'].copiedBytes).toBe(24);
    });

    it('can permute arrays before the first indexed write', () => {
        const result = compare(`First = array 1 2
Second = array 3 4
for I in 1 to 3
 unpack First Second = tuple Second First
 First 0 += I
 if I equal 2
  break
 end
end
tuple First Second`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('returns a captured array and rechecks its current binding', () => {
        const result = compare(`Source = array 1 2
fun N saved
 return Source
end
Saved = Source
for I in 1 to 3
 Saved = I saved
 Source 0 += I
end
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it.each(['true', '"text"', '2.5'])('preserves captured %s array domains', fill => {
        const result = compare(`Source = array shape 2 fill ${fill}
fun N saved
 return Source
end
Saved = Source
for I in 1 to 3
 Saved = I saved
 Source 0 = ${fill}
end
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it.each([false, true])('keeps committed stores on cancellation (compiled: %s)', compilation => {
        const diagnostics = new RuntimeDiagnostics();
        let polls = 0;
        const signal: InterruptSignal = { length: 1, load: () => 0,
            store() {}, exchange: () => ++polls > 2 ? 1 : 0, wait() {} };
        const runtime = withInterrupt(signal, () => new Interpreter(() => {}, { compilation, scalarEntryCompilation: false }));
        try {
            runtime.execute(`fun A pass
 return A
end
Source = array 0 0
Saved = Source`);
            expect(() => diagnostics.run(() => withInterrupt(signal, () => runtime.execute(`for I in 1 to 2000
 Saved = Source pass
 Source 0 += I
end`)))).toThrow(InterruptedError);
            const source = readArrayItem(runtime.variables.get('Source') as import('../src/index.js').RankArray, 0) as bigint;
            const saved = readArrayItem(runtime.variables.get('Saved') as import('../src/index.js').RankArray, 0);
            expect(source).toBeGreaterThanOrEqual(3n);
            const current = BigInt(Math.floor((Math.sqrt(8 * Number(source) + 1) - 1) / 2));
            expect(source).toBe(current * (current + 1n) / 2n);
            expect([source, source - current]).toContain(saved);
            if (compilation) expect(diagnostics.compiledLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('keeps exact integers without replaying preceding array writes', () => {
        const result = compare(`fun A pass
 return A
end
Source = array 0 0
Saved = Source
Value = 9007199254740991
for I in 1 to 3
 Saved = Source pass
 Source 0 += 1
 Value *= 2
end
tuple Source Saved Value`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
        expect(result.observation.value).toContain('72057594037927928');
    });

    it('returns a retained snapshot from inside a writing loop', () => {
        const result = compare(`fun A pass
 return A
end
fun A latest Limit
 Saved = A
 for I in 1 to Limit
  Saved = A pass
  A 0 += I
  if I equal 2
   return Saved
  end
 end
 return A
end
Source = array 1 2
Result = Source latest 5
tuple Source Result`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it.each([
        ['2 to 0 by -1', false], ['0 till 0', false],
        ['0 to 9', true], ['0 to 1 by 0', true],
    ])('preserves selection completion for %s', (selector, error) => {
        const result = compare(`fun A selected
 return A (${selector})
end
Source = array 1 2 3
Saved = Source
for I in 1 to 3
 Saved = Source selected
 Source 0 += I
end
tuple Saved Source`);
        expect(!!result.observation.error).toBe(error);
        expect(result.loops).toBe(1);
    });

    it.each(['queue', 'stack', 'deque'])('retains scalar array domains in %s', kind => {
        for (const [fill, replacement] of [['false', 'true'], ['2.5', '3.5'], ['"before"', '"after"']]) {
            const result = compare(`use algo
Source = array shape 2 fill ${fill}
Saved = Source
Queue = new ${kind}
Queue push Source
for I in 1 to 3
 Saved = Queue pop
 Saved 0 = ${replacement}
 Queue push Saved
 Saved 1 = ${replacement}
end
Source = Queue pop
tuple Saved Source`);
            expect(result.observation.error).toBeUndefined();
            expect(result.loops).toBe(1);
        }
    });

    it.each([['false', 'true'], ['2.5', '3.5'], ['"before"', '"after"']])(
        'permutes %s arrays across writes and early exits', (fill, replacement) => {
            const result = compare(`First = array shape 2 fill ${fill}
Second = array shape 2 fill ${replacement}
for I in 1 to 3
 unpack First Second = tuple Second First
 First 0 = ${replacement}
 if I equal 2
  break
 end
end
tuple First Second`);
            expect(result.observation.error).toBeUndefined();
            expect(result.loops).toBe(1);
        });

    it.each(['+=', '-=', '*='])('retains returned aliases during accumulating %s', operator => {
        const result = compare(`fun A pass
 return A
end
Source = array 1 2 3
Saved = Source
Keys = array 0 0 2
for I in 1 to 3
 Saved = Source pass
 Source Keys ${operator} I .accumulate
end
tuple Saved Source`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('follows in-place storage widening between stores and reads', () => {
        const result = compare(`fun N row
 return array shape 64 fill 2147483647
end
Total = 0
for I in 1 to 3
 Current = I row
 Current 0 += 1
 Total += Current 0
end
Total`);
        expect(result.observation.value).toBe('6442450944');
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
        expect(result.diagnostics.cowCopies).toBe(0);
    });

    it('publishes preceding scalar assignments before a result binding fails', () => {
        const result = compare(`fun N row
 return array shape 2 fill N
end
Current = array true false
for I in 1 to 3
 Before = I
 Current = I row
 After = I
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.loops).toBe(1);
    });

    it('does not evaluate a result allocation in an empty loop', () => {
        const result = compare(`fun N row
 return array shape N fill 0
end
for I in 1 till 1
 Current = -1 row
end
42`);
        expect(result.observation.value).toBe('42');
        expect(result.loops).toBe(1);
    });

    it.each(['true', '"cell"'])('keeps the returned element domain for %s', fill => {
        const result = compare(`fun N row
 return array shape 2 fill ${fill}
end
for I in 1 to 2
 Current = I row
 Value = Current 0
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('uses the declared rank when reading a returned matrix', () => {
        const result = compare(`fun N matrix
 return array shape 2 2 fill N
end
Total = 0
for I in 1 to 3
 Current = I matrix
 Total += Current 1 1
end
Total`);
        expect(result.observation.value).toBe('6');
        expect(result.loops).toBe(1);
    });

    it('rechecks function identity when an enclosing function is called again', () => {
        const result = compare(`fun N row
 return array shape 1 fill N
end
make = row
fun N total
 Total = 0
 for I in 1 to N
  Current = I make
  Total += Current 0
 end
 return Total
end
Before = 3 total
fun N replacement
 return array shape 1 fill N + 10
end
make = replacement
After = 3 total
array Before After`);
        expect(result.observation.value).toBe('6 36');
        expect(result.loops).toBeGreaterThan(0);
    });

    it('preserves error locations and partial state when the callee fails', () => {
        const result = compare(`fun A getrow N
 return array shape 1 fill A N
end
A = array 1 2
for I in 0 to 2
 Before = I
 Current = A getrow I
 After = I
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.loops).toBe(1);
    });

    it('returns an array call directly from a compiled loop', () => {
        const result = compare(`fun N row
 return array shape 2 fill N
end
fun N outer
 for I in 1 to N
  return I row
 end
 return array 0 0
end
3 outer`);
        expect(result.observation.value).toBe('1 1');
        expect(result.loops).toBe(1);
    });
});
