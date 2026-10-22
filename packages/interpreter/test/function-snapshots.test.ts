import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, RuntimeDiagnostics } from '../src/index.js';

for (const compilation of [false, true]) describe(`function snapshots (compiled=${compilation})`, () => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    };

    it('snapshots module data when a lazy filter is created', () => {
        expect(run(`use sequences
Limit = 6
fun X below = X less Limit
S' = 1 to 10 filter below
Limit = 3
S array`)).toBe('1 2 3 4 5');
    });

    it('snapshots enclosing data when a lazy filter is created', () => {
        expect(run(`use sequences
fun Limit selected_values
 fun X below = X less Limit
 S' = 1 to 10 filter below
 Limit = 3
 return S array
end
6 selected_values`)).toBe('1 2 3 4 5');
    });

    it('snapshots transitive module reads without confusing shadowed parameters', () => {
        expect(run(`use sequences
Limit = 6
fun X below = X less Limit
fun Limit selected_values
 fun X predicate = X below
 S' = 1 to 10 filter predicate
 Limit = 2
 return S array
end
3 selected_values`)).toBe('1 2 3 4 5');
    });

    it('keeps direct calls live while an existing pipeline keeps its snapshot', () => {
        expect(run(`use sequences
Limit = 6
fun X below = X less Limit
S' = 1 to 10 filter below
Limit = 3
A = 4 below
B = S sum
(A equal false) and (B equal 15)`)).toBe('true');
    });

    it('snapshots a user function applied at rank', () => {
        expect(run(`use sequences
Offset = 10
fun X shift_by = X + Offset
Values = array 1 2 3
Mapped' = Values shift_by rank 0
Offset = 20
Mapped`)).toBe('11 12 13');
    });

    it('snapshots the callback of a lazy outer product', () => {
        expect(run(`use sequences
Offset = 10
fun A B pair_sum rank 0 0 = A + B + Offset
Pairs' = (array 1 2) (array 3 4) outer pair_sum
Offset = 100
Pairs`)).toBe('14 15 15 16');
    });

    it('snapshots the callback of a sequence scan', () => {
        expect(run(`use sequences
Offset = 10
fun A B combine = A + B + Offset
S' = 1 to 3 scan combine
Offset = 100
S array`)).toBe('1 13 26');
    });

    it('snapshots a lazy merge key', () => {
        expect(run(`use sequences
Sign = 1
fun X key = X * Sign
S' = (array 1) (array 2) merge by key
Sign = -1
S array`)).toBe('1 2');
    });

    it('retains a segment callback snapshot for later queries and writes', () => {
        expect(run(`use algo
use sequences
Offset = 0
fun A B combine = A + B + Offset
Tree = (array 1 2 3) segment combine with 0
Offset = 10
Before = Tree 1 2 query
Tree 0 = 4
After = Tree 0 2 query
array Before After`)).toBe('5 9');
    });

    it('retains scalar array captures through CoW', () => {
        expect(run(`use sequences
Limits = array 6
fun X below = X less (Limits 0)
S' = 1 to 10 filter below
Limits 0 = 3
S array`)).toBe('1 2 3 4 5');
    });

    it('does not copy cells merely to snapshot an owned scalar array', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use sequences\nLimits = array 6\nfun X below = X less (Limits 0)');
            const stats = new RuntimeDiagnostics();
            stats.run(() => runtime.execute("S' = 1 to 10 filter below"));
            expect(stats.cowCopies).toBe(0);
            expect(stats.cowCopiedCells).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('snapshots module dependencies when a generator is created', () => {
        expect(run(`use sequences
Limit = 3
fun N values
 for I in 1 to N
  yield I + Limit
 end
end
S' = 3 values
Limit = 10
S array`)).toBe('4 5 6');
    });

    it('freezes a transitive module read before consumption', () => {
        expect(run(`use sequences
Limit = 6
fun X below = X less Limit
fun X predicate = X below
S' = 1 to 10 filter predicate
Limit = 3
S array`)).toBe('1 2 3 4 5');
    });

    it('snapshots dependencies used only by a callback-local helper', () => {
        expect(run(`use sequences
Limit = 6
fun X predicate
 fun Y below = Y less Limit
 return X below
end
S' = 1 to 10 filter predicate
Limit = 3
S array`)).toBe('1 2 3 4 5');
    });

    it('protects mutable data retained by a callback snapshot', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use algo
use sequences
Items = new queue
Items push 1
Alias = Items
fun X contains = X in Items
S' = 1 to 10 filter contains`);
            expect(() => runtime.execute('Alias push 2')).toThrow('contains is read-only');
            expect(runtime.execute('S sum')).toBe(1n);
        } finally { runtime.dispose(); }
    });
});
