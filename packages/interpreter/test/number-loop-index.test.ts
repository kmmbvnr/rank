import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { IndexEntries } from '../src/index-storage.js';
import { isRankIndex } from '../src/value.js';
import { protectValue } from '../src/value-protection.js';
import { withInterrupt } from '../src/interrupt.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}, setup?: (runtime: Interpreter) => void) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    try {
        setup?.(runtime);
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        const variables = [...runtime.variables].map(([name, value]) => [name, isRankIndex(value)
            ? [...value.entries].map(([key, entry]) => [String(key), formatValue(entry)]) : formatValue(value)]);
        return { diagnostics, observation: { error, variables } };
    } finally { runtime.dispose(); }
}
function compare(source: string, setup?: (runtime: Interpreter) => void) {
    const result = execute(source, {}, setup);
    expect(result.observation).toEqual(execute(source, { compilation: false }, setup).observation);
    expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }, setup).observation);
    return result;
}

describe('private integer index loops', () => {
    it('shares tuple and negative keys through aliases and preserves insertion order', () => {
        const result = compare(`use algo
Cache = new index
Alias = Cache
Cache -1 = 9
Total = 0
for I in 1 to 5
 Cache I 0 = I * 2
 Alias I 0 += 1
 Cache (-1) += I
 if -1 in Cache and -2 not in Alias
  Total += Alias I 0
 end
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each(['simple', 'compound', 'read'])('discards all private state before %s overflow replay', mode => {
        const result = compare(`use algo
Cache = new index
Alias = Cache
Cache 0 = ${mode === 'read' ? '9007199254740992' : '0'}
A = array 0 0
Original = A
Done = 0
for I in 0 to 1
 Cache 1 = I
 A I += 1
 Done += 1
 ${mode === 'simple' ? 'Cache 2 = 9007199254740991 + I' : mode === 'compound' ? 'Alias 0 += 9007199254740991' : 'Wide = Alias 0'}
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
        if (mode === 'read') expect(result.diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    });

    it.each(['Cache 99', '1 // 0', 'A 2', 'Cache 99 += 1'])('publishes preceding index/array/scalar stores on %s', failure => {
        const result = compare(`use algo
Cache = new index
Alias = Cache
A = array 0 0
Original = A
Done = 0
for I in 0 to 1
 Cache I = I + 10
 A I = I + 20
 Done += 1
 if I equal 1
  R = ${failure === 'Cache 99 += 1' ? '0\n  Cache 99 += 1' : failure}
 end
end`);
        expect(result.observation.error).toBeDefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([false, true])('preserves the existing protected-storage entry audit for a conditional store: %s', write => {
        const result = compare(`Done = 0
for I in 0 to 2
 Done += 1
 if ${write ? 'I equal 1' : 'false'}
  Cache I = 1 // (I - 1)
 end
end`, runtime => {
            runtime.execute('use algo\nCache = new index\nAlias = Cache');
            protectValue(runtime.variables.get('Alias')!, 'protected index');
        });
        // Capture/mutation validation rejects these stores before execution,
        // including unreachable stores, in all existing backends.
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.observation.error).toContain('protected index');
    });

    it('falls back for mixed index values without eagerly reading an unused key', () => {
        const result = compare(`use algo
Cache = new index
Cache 0 = "unused"
Total = 0
for I in 1 to 3
 Cache I = I
 Total += Cache I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it('rechecks unsafe cells only when they are actually read', () => {
        const result = compare(`use algo
Cache = new index
Cache 0 = 9007199254740992
Total = 0
for I in 1 to 3
 Cache I = I
 Total += Cache I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it('does not speculate through a host Map read override', () => {
        let reads = 0;
        const result = compare(`Total = 0
for I in 1 to 3
 Total += Cache I
end`, runtime => {
            runtime.execute('use algo\nCache = new index\nCache 1 = 7\nCache 2 = 8\nCache 3 = 9');
            const value = runtime.variables.get('Cache')!;
            if (!isRankIndex(value)) throw Error('expected index');
            const get = value.entries.get.bind(value.entries);
            value.entries.get = key => { reads++; return get(key); };
        });
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(reads).toBeGreaterThan(0);
    });

    it('does not invoke a host get accessor while guarding an unused index read', () => {
        let reads = 0;
        const result = compare(`Total = 0
for I in 1 to 3
 if false
  Total += Cache I
 end
end`, runtime => {
            runtime.execute('use algo\nCache = new index');
            const value = runtime.variables.get('Cache')!;
            if (!isRankIndex(value)) throw Error('expected index');
            Object.defineProperty(value.entries, 'get', { get() {
                reads++;
                return Map.prototype.get;
            } });
        });
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(reads).toBe(0);
    });

    it('shares overlays between different wrappers of the same entries', () => {
        const result = compare(`Total = 0
for I in 1 to 3
 Cache I = I
 Alias I += 1
 Total += Cache I
end`, runtime => {
            runtime.execute('use algo\nCache = new index');
            const cache = runtime.variables.get('Cache')!;
            if (!isRankIndex(cache)) throw Error('expected index');
            runtime.variables.set('Alias', { kind: 'index', entries: cache.entries });
        });
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('rechecks the integer domain on a cached function loop', () => {
        const result = compare(`use algo
fun tally Table
 Total = 0
 for I in 1 to 2
  Total += Table I
 end
 return Total
end
Cache = new index
Cache 1 = 3
Cache 2 = 4
First = tally Cache
Cache 2 = "bad"
Second = tally Cache`);
        expect(result.observation.error).toBeDefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('retains host entry callbacks on the publishing backend', () => {
        let writes = 0;
        const result = compare(`for I in 1 to 3
 Cache I = I
end`, runtime => {
            runtime.execute('use algo');
            runtime.variables.set('Cache', { kind: 'index', entries: new IndexEntries(value => {
                writes++;
                return value;
            }) });
        });
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(writes).toBe(9);
    });

    it('publishes cancellation progress together with arrays and finally', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            runtime.execute('use algo\nCache = new index\nCache 0 = 0\nA = array 0\nLast = -1\nDone = 0');
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`try
 for I in 0 to 1000000
  Cache 0 += 1
  A 0 += 1
  Last = I
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            runtime.execute('Count = Cache 0\nCell = A 0');
            expect(runtime.variables.get('Count')).toBe((runtime.variables.get('Last') as bigint) + 1n);
            expect(runtime.variables.get('Cell')).toBe(runtime.variables.get('Count'));
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
});
