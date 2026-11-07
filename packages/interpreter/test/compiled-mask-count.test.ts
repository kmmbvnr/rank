import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

it.each([0, 1, 7, 4097])('counts changing private masks over %s cells', length => {
    const source = `use sequences
Values = 0 till ${length} copy
Total = 0
for Turn in 0 to 2
 Mask = Values mod 3 equal Turn
 Total += Mask count
end`;
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Total')).toBe(BigInt(length));
            if (compilation) expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    }
});

it('counts all cells in multidimensional real predicates', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`use sequences
Values = (array 1.5 -2.0 3.0 0.0) reshape 2 2
Total = 0
for Turn in 0 to 2
 Total += (Values greater Turn) count
end`));
            expect(runtime.variables.get('Total')).toBe(5n);
            if (compilation) expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    }
});

it('counts a fresh mutable mask while retaining earlier snapshots', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`use sequences
Mask = array shape 5 fill false
Saved = Mask
Total = 0
for Turn in 0 to 2
 Mask Turn = true
 Total += Mask count
end`));
            expect(runtime.variables.get('Total')).toBe(6n);
            expect((runtime.variables.get('Saved') as RankArray).items).toEqual(Array(5).fill(false));
        } finally { runtime.dispose(); }
    }
});

it('compiles count and indices after a numeric gather without extra brackets', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use numbers
use sequences
Values = 0 till 10 copy
Keys = array 9 2 3 6 7
Result = array shape 0 fill 0
Total = 0
for Turn in 2 to 3
 Mask = Values gcd Turn equal 1
 Total += Mask Keys count
 Result = Mask Keys indices
end`));
        expect(runtime.variables.get('Total')).toBe(5n);
        expect((runtime.variables.get('Result') as RankArray).items).toEqual([1n, 4n]);
        expect(diagnostics.numberLoops).toBe(1);
    } finally { runtime.dispose(); }
});

it('keeps completed external packed masks on their native path', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
Mask = array shape 10000 fill true
Total = 0
for Turn in 1 to 2
 Total += Mask count
end`));
        expect(runtime.variables.get('Total')).toBe(20000n);
        expect(diagnostics.numberLoops).toBe(0);
    } finally { runtime.dispose(); }
});

it('rechecks builtin bindings and budgets after a compiled call', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(`use sequences
fun Values positives
 Total = array shape 1 fill 0
 for Turn in 1 to 2
  Mask = Values greater 0
  Total 0 += Mask count
 end
 return Total
end`);
        const fast = new RuntimeDiagnostics();
        expect((fast.run(() => runtime.execute('(array 1 0 3) positives')) as RankArray).items).toEqual([4n]);
        expect(fast.numberLoops).toBe(1);
        const budgeted = new RuntimeDiagnostics();
        expect((withDemandBudget(1000000, () => budgeted.run(() => runtime.execute('(array 1 0 3) positives'))) as RankArray).items).toEqual([4n]);
        expect(budgeted.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => runtime.execute('(array 1 0 3) positives'))).toThrow('demand budget exhausted');
        expect(() => withInterrupt(new Int32Array([1]), () => runtime.execute('(array 1 0 3) positives'))).toThrow('Interrupted');
        let calls = 0;
        runtime.variables.set('count', native('replacement', 1, () => { calls++; return 99n; }));
        expect((runtime.execute('(array 1 0 3) positives') as RankArray).items).toEqual([198n]);
        expect(calls).toBe(2);
    } finally { runtime.dispose(); }
});

it('preserves errors and completed earlier bindings', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute(`use sequences
Values = array 2 0
Total = 99
for Turn in 1 to 2
 Total = (12 // Values greater 0) count
end`)).toThrow(/zero/);
            expect(runtime.variables.get('Total')).toBe(99n);
        } finally { runtime.dispose(); }
    }
});

it.each(['odd', 'even'])('compiles multidimensional %s predicates including negative cells', operation => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`use numbers
use sequences
Values = (array -3 -2 -1 0 1 2) reshape 2 3
Total = 0
for Turn in 0 to 2
 Mask = (Values + Turn) ${operation}
 Total += Mask count
end`));
            expect(runtime.variables.get('Total')).toBe(9n);
            if (compilation) expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    }
});

it('rechecks a rebound parity function and preserves wide integer parity', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(`use numbers
use sequences
fun Values parities
 Result = array shape 0 fill false
 for Turn in 1 to 2
  Result = Values odd
 end
 return Result
end`);
        expect((runtime.execute('(array 1 2 3) parities') as RankArray).items).toEqual([true, false, true]);
        expect((runtime.execute('(array 9007199254740993 -9007199254740993) parities') as RankArray).items).toEqual([true, true]);
        let calls = 0;
        runtime.variables.set('odd', native('replacement', 1, () => {
            calls++; return { kind: 'array', shape: [1], items: [false] };
        }));
        expect((runtime.execute('(array 1 2 3) parities') as RankArray).items).toEqual([false]);
        expect(calls).toBe(2);
    } finally { runtime.dispose(); }
});

it('preserves raw sequence count and does not force unused lazy names', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
Total = 0
for Turn in 1 to 2
 Unused' = (1 // 0 greater 0) count
 Total += ((0 to 9) greater 4) count
end`);
            expect(runtime.variables.get('Total')).toBe(10n);
        } finally { runtime.dispose(); }
    }
});

it('counts a function-owned mutable Boolean constructor in the compiled region', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
fun Limit counts
 Mask = array shape Limit fill false
 Totals = array shape 3 fill 0
 for Turn in 0 to 2
  Mask Turn = true
  Totals Turn = Mask count
 end
 return Totals
end
Counts = 5 counts`));
        expect((runtime.variables.get('Counts') as RankArray).items).toEqual([1n, 2n, 3n]);
        expect(diagnostics.numberLoops).toBe(1);
    } finally { runtime.dispose(); }
});
