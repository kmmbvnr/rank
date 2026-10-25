import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, isNativeFunction } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { RankDeque } from '../src/containers.js';
import { hasIntegerDequeIteration } from '../src/compiled-argument-type.js';
import { newStructure, addToCollection } from '../src/collections.js';
import { IntegerEntries } from '../src/integer-entries.js';

function run(source: string, compilation: boolean, scalarEntryCompilation = true) {
    let functions = 0, loops = 0;
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { compilation, scalarEntryCompilation,
        onScalarFunctionExecuted: () => functions++, onIntegerLoopExecuted: () => loops++ });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { value: value && isNativeFunction(value) ? undefined : value, output, functions, loops, fallbacks: diagnostics.fallbacks };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), output, functions, loops, fallbacks: diagnostics.fallbacks };
    } finally { runtime.dispose(); }
}
function compare(source: string, scalarEntryCompilation = true) {
    const reference = run(source, false), compiled = run(source, true, scalarEntryCompilation);
    expect(compiled.value).toEqual(reference.value);
    expect(compiled.error).toEqual(reference.error);
    expect(compiled.output).toEqual(reference.output);
    return compiled;
}

describe('compiled integer collections', () => {
    it.each([false, true])('uses set keys for membership in mutable nested loops (function entry: %s)', entry => {
        const result = compare(`use algo
fun Limit helper
 Q = new queue
 S = new set
 Q push -2
 Q push 7
 S add -2
 S add 7
 Total = 0
 for N in 1 to Limit
  for A in Q
   if A in S
    Total += A
   end
   if N not in S
    Total += 1
   end
  end
 end
 S add 3
 for A in Q
  if 3 in S
   Total += 1
  end
 end
 return Total
end
4 helper`, entry);
        expect(result.value).toBe(30n);
        expect(result.fallbacks['loop:input-type']).toBeUndefined();
        if (entry) expect(result.functions).toBe(1);
        else expect(result.loops).toBeGreaterThan(0);
    });

    it.each(['queue', 'deque', 'stack'])('keeps live %s iteration, aliases and independent ordinals', kind => {
        const result = compare(`use algo
fun N helper
 Q = new ${kind}
 Q push 1
 Alias = Q
 Total = 0
 for A Ord in Q
  if A less N
   Alias push (A + 1)
  end
  Total += A * 10 + Ord
  Ord = 99
  if A equal 2
   continue
  end
  if A equal N
   break
  end
 end
 return Total
end
4 helper`);
        expect(result.value).toBe(106n);
        expect(result.functions).toBe(1);
    });

    it('captures the queue before rebinding its slot', () => {
        const result = compare(`use algo
fun N helper
 Q = new queue
 Q push 2
 Q push 3
 Total = 0
 for A in Q
  Q = new queue
  Q push 100
  Total += A
 end
 return Total
end
0 helper`);
        expect(result.value).toBe(5n);
        expect(result.functions).toBe(1);
    });

    it('keeps nested early returns and empty queues', () => {
        const result = compare(`use algo
fun N helper
 Q = new queue
 for I in 1 to N
  Q push I
 end
 for A in Q
  for B in Q
   if B greater A
    return A * 10 + B
   end
  end
 end
 return 0
end
(0 helper) + (3 helper)`);
        expect(result.value).toBe(12n);
        expect(result.functions).toBe(2);
    });

    it('compiles constructor-owned array writes, including linked calls', () => {
        const result = compare(`use algo
fun N helper
 A = array shape N fill 0
 Alias = A
 Seen = new set
 for I in 0 till N
  Seen add I
  A I = I + 1
 end
 if 0 in Seen
  return (A 0) + (Alias 0)
 end
 return -1
end
fun N outer
 Total = N helper
 return Total + 1
end
3 outer`);
        expect(result.value).toBe(2n);
        expect(result.functions).toBe(2);
    });

    it('keeps writes through argument aliases on the framed path', () => {
        const result = compare(`fun Input helper
 A = Input
 A 0 = 9
 return A 0
end
Values = array 1 2
Result = Values helper
Result + (Values 0)`);
        expect(result.value).toBe(10n);
        expect(result.functions).toBe(0);
    });

    it.each(['Total = 1 // (A - 2)', 'Q push "bad"'])('preserves error location and call trace for %s', body => {
        const result = compare(`use algo
fun N helper
 Q = new queue
 Q push 1
 Q push 2
 Total = 0
 for A in Q
  ${body}
 end
 return Total
end
2 helper`);
        expect(result.error).toBeDefined();
    });

    it('uses the tracked queue contract only with unchanged methods', () => {
        const queue = new RankDeque();
        queue.push(1n);
        expect(hasIntegerDequeIteration(queue)).toBe(true);
        const values = vi.spyOn(queue, 'values').mockImplementation(function* () { yield 'host'; });
        try { expect(hasIntegerDequeIteration(queue)).toBe(false); }
        finally { values.mockRestore(); }
        expect(hasIntegerDequeIteration(queue)).toBe(true);
        queue.pop();
        expect(() => queue.push('text')).toThrow('holds integer');
        expect(hasIntegerDequeIteration(queue)).toBe(true);
    });

    it('declines function entry after a queue iterator prototype replacement', () => {
        let functions = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => functions++ });
        runtime.execute(`use algo
fun N helper
 Q = new queue
 Q push 1
 Total = 0
 for A in Q
  Total += A
 end
 return Total
end`);
        try {
            expect(runtime.execute('0 helper')).toBe(1n);
            expect(functions).toBe(1);
            const values = vi.spyOn(RankDeque.prototype, 'values').mockImplementation(function* () { yield 7n; });
            try { expect(runtime.execute('0 helper')).toBe(7n); }
            finally { values.mockRestore(); }
            expect(functions).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('declines set entry with a host membership override', () => {
        let functions = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => functions++ });
        runtime.execute(`use algo
fun S helper
 return 3 in S
end`);
        const fn = runtime.variables.get('helper');
        if (!fn || !isNativeFunction(fn)) throw new Error('missing helper');
        const set = newStructure('set');
        addToCollection(set, 3n);
        try {
            expect(fn.call([set])).toBe(true);
            expect(functions).toBe(1);
            if (typeof set !== 'object' || set.kind !== 'set') throw new Error('missing set');
            const has = vi.spyOn(set.entries, 'has').mockReturnValue(false);
            try { expect(fn.call([set])).toBe(false); }
            finally { has.mockRestore(); }
            expect(functions).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('rechecks membership prototypes for sets constructed inside the function', () => {
        let functions = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => functions++ });
        runtime.execute(`use algo
fun N helper
 S = new set
 S add N
 return N in S
end`);
        try {
            expect(runtime.execute('9007199254740993 helper')).toBe(true);
            expect(functions).toBe(1);
            const has = vi.spyOn(IntegerEntries.prototype, 'has').mockReturnValue(false);
            try { expect(runtime.execute('9007199254740993 helper')).toBe(false); }
            finally { has.mockRestore(); }
            expect(functions).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('compiles unchanged Euler 044 at full size', () => {
        const source = readFileSync(new URL('../../../demos/euler/044_pentagondiff.ra', import.meta.url), 'utf8');
        const result = compare(source);
        expect(result.value).toBeUndefined();
        expect(result.output).toEqual(['5482660']);
        expect(result.functions).toBe(4401);
        expect(Object.keys(result.fallbacks)).toEqual([]);
    }, 15000);

    it('compiles unchanged Euler 023 at full size', () => {
        const source = readFileSync(new URL('../../../demos/euler/023_abundantsums.ra', import.meta.url), 'utf8');
        const result = compare(source);
        expect(result.value).toBeUndefined();
        expect(result.output).toEqual(['4179871']);
        expect(result.functions).toBe(1);
        expect(Object.keys(result.fallbacks)).toEqual([]);
    }, 15000);
});
