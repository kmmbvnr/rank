import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newStructure } from '../src/collections.js';
import { IntegerEntries } from '../src/integer-entries.js';
import { compiledEntryArgumentType } from '../src/compiled-argument-type.js';
import { protectValue } from '../src/value-protection.js';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, type RankValue } from '../src/index.js';

function execute(source: string, compilation = true) {
    const diagnostics = new RuntimeDiagnostics();
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        let error: string | undefined, value: RankValue | undefined;
        try { value = diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        const index = runtime.variables.get('Cache');
        return { diagnostics, calls, error, value: value === undefined ? undefined : formatValue(value), answer: runtime.variables.get('Answer'),
            entries: index && typeof index === 'object' && index.kind === 'index' ? [...index.entries] : undefined };
    } finally { runtime.dispose(); }
}
function compare(source: string, expectedFailure = false) {
    const actual = execute(source), reference = execute(source, false);
    expect({ answer: actual.answer, entries: actual.entries, error: actual.error, value: actual.value })
        .toEqual({ answer: reference.answer, entries: reference.entries, error: reference.error, value: reference.value });
    if (!expectedFailure) expect(actual.error).toBeUndefined();
    return actual;
}

describe('sparse integer profile compilation', () => {
    it('uses a live set iterator with independent ordinals and aliased additions', () => {
        const result = compare(`use algo
Seen = new set
Seen add 1
Seen add 2
Seen add 3
Alias = Seen
Answer = 0
for X Ordinal in Seen
  if X equal 1
    Alias add 4
  end
  Answer += X * 10 + Ordinal
end`);
        expect(result.answer).toBe(106n);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('declines host iterator overrides without invoking getters during the guard', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.execute('use algo\nSeen = new set\nSeen add 1\nAnswer = 0.0');
                const value = runtime.variables.get('Seen')!;
                if (typeof value !== 'object' || value.kind !== 'set') throw new Error('expected set');
                let reads = 0;
                Object.defineProperty(value.entries, 'values', { get: () => {
                    reads++;
                    return function* () { yield 1.5; };
                } });
                diagnostics.run(() => runtime.execute('for X in Seen\n Answer += X\nend'));
                expect(runtime.variables.get('Answer')).toBe(1.5);
                expect(reads).toBe(2);
                expect(diagnostics.compiledLoops).toBe(0);
            } finally { runtime.dispose(); }
        }
    });

    it('keeps existing bindings when a set is empty', () => {
        const result = compare(`use algo
Seen = new set
X = "kept"
Total = 0
for Item in Seen
  Total += Item
end
Answer = X`);
        expect(result.answer).toBe('kept');
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('links integer set arguments from a compiled loop', () => {
        const result = compare(`use algo
fun N populate Store
  for I in 1 to N
    Store add I
  end
  return 1
end
Seen = new set
Answer = 0
for N in 1 to 3
  Answer += N populate Seen
end
Answer += Seen sum`);
        expect(result.answer).toBe(9n);
        expect(result.calls).toBe(3);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('updates integer-domain proofs across replacement, deletion and clear', () => {
        const entries = new IntegerEntries();
        entries.set('a', 1n).set('b', false);
        expect(entries.integers).toBe(false);
        entries.set('b', 2n);
        expect(entries.integers).toBe(true);
        entries.set('a', 'text');
        entries.delete('a');
        expect(entries.integers).toBe(true);
        entries.set('c', 1.5);
        entries.clear();
        expect(entries.integers).toBe(true);
    });

    it('declines foreign, protected and noninteger sets at compiled call entry', () => {
        const value = newStructure('set');
        expect(compiledEntryArgumentType(value)).toEqual({ kind: 'set' });
        if (typeof value !== 'object' || value.kind !== 'set') throw new Error('expected set');
        value.entries.set('real', 1.5);
        expect(compiledEntryArgumentType(value)).toBeUndefined();
        value.entries.clear();
        protectValue(value, 'protected set');
        expect(compiledEntryArgumentType(value)).toBeUndefined();
        expect(compiledEntryArgumentType({ kind: 'set', entries: new Map([['number:1', 1n]]) })).toBeUndefined();
    });

    it.each([2, 3, 4, 6, 8, 10])('retains the exact unchanged Euler 393 answer for N=%s', n => {
        const source = readFileSync(new URL('../../../demos/euler/393_ants.ra', import.meta.url), 'utf8')
            .replace('option N integer = 10', `option N integer = ${n}`);
        const expected = new Map([[2, 2n], [3, 0n], [4, 88n], [6, 207408n],
            [8, 22902801416n], [10, 112398351350823112n]]);
        const result = n <= 6 ? compare(source) : execute(source);
        expect(result.error).toBeUndefined();
        expect(result.answer).toBe(expected.get(n));
        expect(result.calls).toBeGreaterThan(0);
        expect(result.diagnostics.compiledLoops).toBeGreaterThan(0);
    }, 10000);

    it.each(['+=', '-=', '*=', '//=', 'mod='])('compiles exact index arithmetic for %s', operator => {
        const result = compare(`use algo
fun Store update
  Store 1 ${operator} 2
  return Store 1
end
Cache = new index
Cache 1 = 120
Answer = Cache update
for I in 1 to 3
  Cache 1 ${operator} I
end
Answer = Cache 1`);
        expect(result.calls).toBeGreaterThan(0);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('keeps generic real-valued index accumulation', () => {
        const result = compare(`use algo
Cache = new index
Cache 1 = 1.5
for I in 1 to 2
  Cache 1 += 1.0
end
Answer = Cache 1`);
        expect(result.answer).toBe(3.5);
    });

    it('retains the undefined completion value of index updates', () => {
        const result = compare(`use algo
Cache = new index
Cache 0 = 0
for I in 1 to 3
  Cache 0 += I
end`);
        expect(result.value).toBeUndefined();
        expect(result.entries).toEqual([[0, 6n]]);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('checks protected indices before evaluating the RHS', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('use algo\nCache = new index\nCache 1 = 1');
                protectValue(runtime.variables.get('Cache')!, 'protected index');
                expect(() => runtime.execute('for I in 1 to 3\n Cache 1 += (1 // 0)\nend'))
                    .toThrow('protected index');
            } finally { runtime.dispose(); }
        }
    });

    it('updates exact index values through aliases in compiled loops', () => {
        const result = compare(`use algo
Cache = new index
Alias = Cache
Cache 1 = 9007199254740993
for I in 1 to 4
  Alias 1 += I
end
Answer = Cache 1`);
        expect(result.answer).toBe(9007199254741003n);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it('compiles integer index compound writes in recursive calls', () => {
        const result = compare(`use algo
fun N countup Store
  if N equal 0
    return 0
  end
  Store 1 += N
  (N - 1) countup Store
  return Store 1
end
Cache = new index
Cache 1 = 9007199254740993
Answer = 4 countup Cache`);
        expect(result.answer).toBe(9007199254741003n);
        expect(result.calls).toBeGreaterThan(0);
    });

    it.each(['+=', '-=', '*=', '//=', 'mod='])('matches missing-key errors for %s', operator => {
        const result = compare(`use algo
Cache = new index
Cache 2 = 3
for I in 1 to 2
  Cache I ${operator} 2
end`, true);
        expect(result.error).toContain('index key not found');
        expect(result.entries).toEqual([[2, 3n]]);
    });

    it('retains RHS-before-read ordering when an aliased callee changes the old value', () => {
        const result = compare(`use algo
fun Store change
  Store 1 = 10
  return 2
end
fun Store update
  Store 1 += Store change
  return Store 1
end
Cache = new index
Cache 1 = 1
Answer = Cache update`);
        expect(result.answer).toBe(12n);
    });
});
