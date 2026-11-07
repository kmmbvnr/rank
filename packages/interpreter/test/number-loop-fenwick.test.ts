import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type RankValue } from '../src/index.js';
import { RankFenwick } from '../src/fenwick.js';
import { protectValue } from '../src/value-protection.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}, setup?: (runtime: Interpreter) => void, scope: (run: () => unknown) => unknown = run => run()) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    try {
        setup?.(runtime);
        let error: string | undefined, result: unknown;
        try { result = scope(() => diagnostics.run(() => runtime.execute(source))); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        const variables = [...runtime.variables].map(([name, value]) => {
            if (!(value instanceof RankFenwick)) return [name, formatValue(value)];
            const positions = value.size < 512 ? Array.from({ length: value.size }, (_, i) => i) : [0, 1, value.size - 1];
            return [name, { size: value.size, cells: positions.map(i => [RankFenwick.prototype.at.call(value, BigInt(i)), RankFenwick.prototype.sum.call(value, BigInt(i))]) }];
        });
        return { diagnostics, observation: { error, result: result === undefined ? undefined : formatValue(result as RankValue), variables } };
    } finally { runtime.dispose(); }
}
function compare(source: string, setup?: (runtime: Interpreter) => void) {
    const result = execute(source, {}, setup);
    expect(result.observation).toEqual(execute(source, { compilation: false }, setup).observation);
    expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }, setup).observation);
    return result;
}

describe('private numeric Fenwick loops', () => {
    it.each([false, true])('shares aliases and publishes arrays and index writes (seeded=%s)', seeded => {
        const result = compare(`use algo
F = 8 fenwick
G = 2 fenwick
Alias = F
${seeded ? 'F 2 = -7\nG 0 = 3' : ''}
A = array shape 8 fill 0
Cache = new index
Total = 0
for I in 0 to 7
 Alias I += I + 1
 A I = F sum I
 Cache I = A I
 Total += (F sum I) + (G sum (-1))
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([2147483646, 9007199254740980])('composes representations, aliases and native calls at %s', initial => {
        const result = compare(`use algo
use numbers
F = 1 fenwick
Tree = F
Cache = new index
Cache 0 = ${initial}
Lookup = Cache
A = array ${initial}
Total = 10 ** 30
for I in 1 to 3
 A 0 += I gcd 6
 Tree 0 = A 0
 Lookup 0 = F sum 0
 Total += Cache 0
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it('reports the missing call-result representation proof in a wide expression', () => {
        const result = compare(`use algo
use numbers
F = 1 fenwick
Cache = new index
A = array 1
Total = 10 ** 30
for I in 1 to 3
 F 0 = A 0
 Cache 0 = F 0
 Total += (Cache 0) + (I gcd 6)
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:call-number-result-proof']).toBeGreaterThan(0);
    });

    it.each([false, true])('replays composed storage and calls once (seeded index=%s)', seeded => {
        const result = compare(`use algo
use numbers
F = 1 fenwick
Tree = F
Cache = new index
${seeded ? 'Cache 0 = 7' : ''}
Lookup = Cache
A = array 2147483647
Total = 0
for I in 1 to 3
 A 0 += I gcd 6
 Lookup I = A 0
 Tree 0 += I
 Total += F sum 0
 Wide = 9007199254740990 + I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it.each(['Tree', 'Lookup'])('preserves protected %s errors before RHS calls and publishes prior stores', protectedName => {
        const result = compare(`for I in 1 to 3
 A 0 += I gcd 6
 ${protectedName === 'Tree' ? 'Lookup' : 'Tree'} 0 = I
 ${protectedName} 0 = (I gcd 6) // (I - 1)
end`, runtime => {
            runtime.execute('use algo\nuse numbers\nF = 1 fenwick\nTree = F\nCache = new index\nLookup = Cache\nCache 0 = 0\nA = array 0');
            protectValue(runtime.variables.get(protectedName)!, 'protected container');
        });
        expect(result.observation.error).toContain('protected container');
        expect(result.observation.error).not.toContain('division by zero');
    });

    it('returns the final compound write as an exact integer', () => {
        const result = compare('use algo\nF = 4 fenwick\nfor I in 0 to 3\n F 0 += I\nend');
        expect(result.observation.result).toBe('6');
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it.each([
        ['tree node', 'F 0 = 9007199254740990\nF 1 = 1', 'Alias 2 += 1'],
        ['delta', 'F 0 = -9007199254740991\nF 1 = 9007199254740991', 'Alias 0 = 9007199254740991'],
        ['cell', '', 'Alias 0 = 9007199254740991 + I'],
    ])('discards partial %s updates before replay with aliases and other storage', (_, initial, store) => {
        const result = compare(`use algo
F = 8 fenwick
Alias = F
${initial}
A = array 0 0 0
Cache = new index
Done = 0
for I in 0 to 2
 A I += 1
 Cache I = I
 ${store}
 Done += 1
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('falls back when safe tree nodes form an unsafe prefix', () => {
        const result = compare(`use algo
F = 3 fenwick
F 0 = 9007199254740991
F 2 = 9007199254740991
Total = 0
for I in 0 to 2
 Total += F sum I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it.each([
        'F 0 = 9007199254740992',
        'F 0 = 9007199254740991\nF 1 = 1',
        'F 0 = 9007199254740991\nF 1 = 9007199254740991\nF 2 = -9007199254740991',
    ])('keeps wide buffers exact without rebuilding cancellation-prone nodes: %s', initial => {
        const result = compare(`use algo
F = 4 fenwick
${initial}
Total = 0
for I in 0 to 3
 F 3 += 1
 Total += F sum 3
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
    });

    it.each(['F 0 += 7 // (2 - I)', 'F 8 = 9', 'Total += F sum (-2)', 'Total += F 8'])(
        'publishes preceding effects on error: %s', failing => {
            const result = compare(`use algo
F = 8 fenwick
Alias = F
A = array 0 0 0
Cache = new index
Total = 0
for I in 0 to 2
 Alias 0 += 1
 A I += 1
 Cache I = I
 ${failing}
end`);
            expect(result.observation.error).toBeDefined();
            expect(result.diagnostics.numberLoops).toBe(1);
        });

    it('preserves protection before evaluating a failing RHS', () => {
        const result = compare('for I in 0 to 2\n F 0 = 7 // 0\nend', runtime => {
            runtime.execute('use algo\nF = 4 fenwick');
            protectValue(runtime.variables.get('F')!, 'protected tree');
        });
        expect(result.observation.error).toContain('protected tree');
        expect(result.observation.error).not.toContain('division by zero');
    });

    it.each(['at', 'sum', 'set', 'numberSnapshot'])('rejects modified native %s methods', method => {
        let calls = 0;
        const result = compare('Total = 0\nfor I in 0 to 2\n F I = I\n Total += F I\n Total += F sum I\nend', runtime => {
            runtime.execute('use algo\nF = 4 fenwick');
            const tree = runtime.variables.get('F') as RankFenwick;
            const original = tree[method as keyof RankFenwick] as (...args: never[]) => unknown;
            Object.defineProperty(tree, method, { value: (...args: never[]) => { calls++; return original.apply(tree, args); } });
        });
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
        if (method === 'numberSnapshot') expect(calls).toBe(0);
        else expect(calls).toBeGreaterThan(0);
    });

    it.each(['at', 'numberSnapshot'])('does not invoke an unused host %s getter while inspecting a tree', method => {
        let calls = 0;
        const result = compare('Total = 0\nfor I in 0 to 2\n if false\n  Total += F 0\n end\nend', runtime => {
            runtime.execute('use algo\nF = 4 fenwick');
            Object.defineProperty(runtime.variables.get('F'), method, { get() { calls++; return () => 99n; } });
        });
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(calls).toBe(0);
    });

    it('does not copy a huge tree for a tiny range beyond the existing probe cap', () => {
        const result = compare('use algo\nF = 200000 fenwick\nfor I in 1 to 3\n F 0 += 1\nend');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });

    it('amortizes a larger snapshot over a proven full range', () => {
        const result = compare('use algo\nF = 100 fenwick\nfor I in 0 to 255\n F (I mod 100) += 1\nend');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
    });

    it.each([0, 1])('retains empty ranges and empty-tree errors (iterations=%s)', iterations => {
        const result = compare(`use algo\nF = 0 fenwick\nfor I in 0 till ${iterations}\n F 0 = 1\nend`);
        if (iterations) expect(result.observation.error).toContain('fenwick index out of bounds: 0');
        else expect(result.observation.error).toBeUndefined();
    });

    it('publishes cancellation progress together with arrays, aliases and finally', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false }), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            runtime.execute('use algo\nF = 4 fenwick\nAlias = F\nA = array 0\nLast = -1\nDone = 0');
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`try
 for I in 0 to 1000000
  Alias 0 += 1
  A 0 += 1
  Last = I
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            const tree = runtime.variables.get('F') as RankFenwick;
            expect(tree.at(0n)).toBe((runtime.variables.get('Last') as bigint) + 1n);
            expect(runtime.execute('A 0')).toBe(tree.at(0n));
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it.each([1, 7, 30, 100])('retains publishing boundaries under a %s-unit demand budget', budget => {
        const source = 'for I in 0 to 100\n F 0 += 1\n Last = I\nend';
        const setup = (runtime: Interpreter) => { runtime.execute('use algo\nF = 4 fenwick\nLast = -1'); };
        const scoped = (run: () => unknown) => withDemandBudget(budget, run);
        const result = execute(source, {}, setup, scoped);
        expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }, setup, scoped).observation);
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.observation.error).toContain('demand budget exhausted');
    });

    it('keeps observable polling on the publishing backend', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use algo\nF = 4 fenwick');
            const signal = { length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {} };
            withInterrupt(signal, () => diagnostics.run(() => runtime.execute('for I in 0 to 10\n F 0 += 1\nend')));
            expect((runtime.variables.get('F') as RankFenwick).at(0n)).toBe(11n);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('keeps a wide accumulator while tree nodes and indices remain numeric', () => {
        const result = compare('use algo\nF = 4 fenwick\nTotal = 10 ** 30\nfor I in 0 to 3\n F I = I\n Total += F I\n Total += F sum I\nend');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it('runs Euler 378 with an exact total and a mixed Fenwick region', () => {
        const source = readFileSync(new URL('../../../demos/euler/378_triangles.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { args: ['--limit=1000'] }), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(11174776n);
            expect(diagnostics.mixedIntegerLoops).toBe(1);
            expect(diagnostics.numberLoopOverflows).toBe(0);
        } finally { runtime.dispose(); }
    });
    it('counts one snapshot for two aliases at the small-copy boundary', () => {
        const result = compare('use algo\nF = 20 fenwick\nAlias = F\nfor I in 0 to 2\n F I = I\n Alias I += 1\nend');
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
    });

    it('allows protected read-only trees and audited scalar calls', () => {
        const result = compare('Total = 0\nfor I in 0 to 3\n Total += (F sum I) + (I gcd 6)\nend', runtime => {
            runtime.execute('use algo\nuse numbers\nF = 4 fenwick\nF 0 = 7');
            protectValue(runtime.variables.get('F')!, 'protected tree');
        });
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('rechecks a cached helper after its receiver widens', () => {
        const result = compare(`use algo
fun F tally N
 Total = 0
 for I in 0 till N
  Total += F sum 0
 end
 return Total
end
Tree = 4 fenwick
First = Tree tally 3
Tree 0 = 10 ** 30
Second = Tree tally 3`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('can cancel while preparing a large snapshot without publishing it', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false }), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            runtime.execute('use algo\nF = 2000 fenwick\nLast = -1\nDone = 0');
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`try
 for I in 0 to 10000
  F 0 += 1
  Last = I
 end
finally
 Done = 1
end`)))).toThrow('Interrupted while preparing fenwick tree');
            expect((runtime.variables.get('F') as RankFenwick).sum(1999n)).toBe(0n);
            expect(runtime.variables.get('Last')).toBe(-1n);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('keeps the original binding contract before replacing a tree with an array', () => {
        const result = compare(`use algo
F = 4 fenwick
Old = F
Total = 0
for I in 0 to 2
 F = array 0 0
 F 0 = I
 Total += F 0
end`);
        expect(result.observation.error).toContain('cannot receive array');
        expect(result.diagnostics.numberLoops).toBe(0);
    });

});

it('counts unconditional Fenwick stores as invariant range work without raising the copy cap', () => {
    const result = compare(`use algo
Tree = 131073 fenwick
for I in 0 till 131074
 Tree 0 += 1
end`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
    expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
}, 30000);
it.each(['for I in 0 till 8', 'for I in 0 till 131074\n if I equal 0\n  break\n end'])('keeps short or interrupted Fenwick ranges conservative: %s', header => {
    const result = compare(`use algo
Tree = 131073 fenwick
${header}
 Tree 0 += 1
end`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(0);
});
