import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

it.each([0, 1, 7, 4097])('compiles changing mask indices over %s cells', count => {
    const source = `use sequences
Values = 0 till ${count} copy
Result = array shape 0 fill 0
Total = 0
for Turn in 0 to 2
 Result = (Values mod 3 equal Turn) indices
 Total += Result sum
end`;
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect((runtime.variables.get('Result') as RankArray).items)
                .toEqual(Array.from({ length: count }, (_, i) => i).filter(i => i % 3 === 2).map(BigInt));
            expect(runtime.variables.get('Total')).toBe(BigInt(count * (count - 1) / 2));
            if (compilation) expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    }
});

it('retains earlier results while the source and current result change', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
Values = array 0 1 2
Saved = array shape 0 fill 0
Result = array shape 0 fill 0
for Turn in 1 to 2
 Mask = Values at least Turn
 Result = Mask indices
 if Turn equal 1
  Saved = Result
 end
 Mask 1 = false
end`));
        expect((runtime.variables.get('Saved') as RankArray).items).toEqual([1n, 2n]);
        expect((runtime.variables.get('Result') as RankArray).items).toEqual([2n]);
        expect(diagnostics.numberLoops).toBe(1);
    } finally { runtime.dispose(); }
});

it('joins a fresh-array helper and its shrinking active mask', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
fun Values powers
 Result = Values copy
 Pending = Result less 100
 Active = Pending indices
 for Active len greater 0
  Current = Result Active
  Result Active = Current * 2
  Pending = Result less 100
  Active = Pending indices
 end
 return Result
end
Result = (1 to 20 copy) powers`));
        expect((runtime.variables.get('Result') as RankArray).items).toEqual(
            Array.from({ length: 20 }, (_, i) => { let n = i + 1; while (n < 100) n *= 2; return BigInt(n); }));
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopCopyProbes).toBe(0);
    } finally { runtime.dispose(); }
});

it('rechecks an overridden indices builtin after an earlier compiled call', () => {
    const runtime = new Interpreter();
    const source = `use sequences
fun Values positions
 Result = array shape 0 fill 0
 for Turn in 1 to 2
  Mask = Values greater 0
  Result = Mask indices
 end
 return Result
end`;
    try {
        runtime.execute(source);
        expect((runtime.execute('(array 1 0) positions') as RankArray).items).toEqual([0n]);
        let calls = 0;
        runtime.variables.set('indices', native('replacement', 1, () => {
            calls++;
            return { kind: 'array', shape: [1], items: [99n] };
        }));
        expect((runtime.execute('(array 1 0) positions') as RankArray).items).toEqual([99n]);
        expect(calls).toBe(2);
    } finally { runtime.dispose(); }
});

it('keeps multidimensional coordinates on the ordinary path', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
Mask = (array true false false true) reshape 2 2
Result = array shape 0 2 fill 0
for Turn in 1 to 2
 Result = Mask indices
end`));
        const result = runtime.variables.get('Result') as RankArray;
        expect(result.shape).toEqual([2, 2]);
        expect(result.items).toEqual([0n, 0n, 1n, 1n]);
        expect(diagnostics.numberLoops).toBe(0);
    } finally { runtime.dispose(); }
});

it('preserves non-boolean errors', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute('use sequences\nMask = array 1 0\nfor I in 1 to 2\n Result = Mask indices\nend'))
                .toThrow('indices expects boolean values');
        } finally { runtime.dispose(); }
    }
});

it('retains budget accounting and cancellation without publishing partial arrays', () => {
    const source = 'use sequences\nMask = array shape 5000 fill true\nResult = array shape 0 fill 0\nfor Turn in 1 to 2\n Result = Mask indices\nend';
    const runtime = new Interpreter();
    try {
        const diagnostics = new RuntimeDiagnostics();
        withDemandBudget(1000000, () => diagnostics.run(() => runtime.execute(source)));
        expect(diagnostics.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => runtime.execute(source))).toThrow('demand budget exhausted');
        expect(() => withInterrupt(new Int32Array([1]), () => runtime.execute(source))).toThrow('Interrupted');
        runtime.execute(source);
        expect((runtime.variables.get('Result') as RankArray).shape).toEqual([5000]);
    } finally { runtime.dispose(); }
});

it('rechecks the budget when reusing a previously compiled function', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(`use sequences
fun Values positions
 Result = array shape 0 fill 0
 for Turn in 1 to 2
  Mask = Values greater 0
  Result = Mask indices
 end
 return Result
end`);
        const fast = new RuntimeDiagnostics();
        fast.run(() => runtime.execute('(array 1 0 3) positions'));
        expect(fast.numberLoops).toBe(1);
        const budgeted = new RuntimeDiagnostics();
        const result = withDemandBudget(1000000, () => budgeted.run(() => runtime.execute('(array 1 0 3) positions'))) as RankArray;
        expect(result.items).toEqual([0n, 2n]);
        expect(budgeted.numberLoops).toBe(0);
        expect(() => withDemandBudget(1, () => runtime.execute('(array 1 0 3) positions'))).toThrow('demand budget exhausted');
    } finally { runtime.dispose(); }
});

it('does not publish a partially computed result when a mask cell fails', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute(`use sequences
Values = array 2 0
Result = array 99
for Turn in 1 to 2
 Result = (12 // Values greater 0) indices
end`)).toThrow(/zero/);
            expect((runtime.variables.get('Result') as RankArray).items).toEqual([99n]);
        } finally { runtime.dispose(); }
    }
});

it('does not force an unused deferred mask', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
Values = array 1 2
Bad' = Values // 0 greater 0
Result = array shape 0 fill 0
for Turn in 1 to 2
 if false
  Result = Bad indices
 end
end`);
            expect((runtime.variables.get('Result') as RankArray).shape).toEqual([0]);
        } finally { runtime.dispose(); }
    }
});

it('preserves the array requirement for an uncompleted finite sequence', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute('use sequences\nfor Turn in 1 to 2\n Result = ((0 to 9) greater 4) indices\nend'))
                .toThrow('indices expects an array of rank at least 1');
        } finally { runtime.dispose(); }
    }
});

it('admits an explicitly completed finite mask', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute('use sequences\nResult = array shape 0 fill 0\nfor Turn in 1 to 2\n Result = (((0 to 9) greater 4) copy) indices\nend'));
        expect((runtime.variables.get('Result') as RankArray).items).toEqual([5n, 6n, 7n, 8n, 9n]);
        expect(diagnostics.numberLoops).toBe(1);
    } finally { runtime.dispose(); }
});

it('keeps completed sparse bitmaps on their native word traversal', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
Mask = array shape 1000000 fill false
Mask (0 till 1000000 by 10000) = true
Total = 0
for Turn in 1 to 20
 Result = Mask indices
 Total += Result sum
end`));
        expect(runtime.variables.get('Total')).toBe(990000000n);
        expect(diagnostics.numberLoops).toBe(0);
        expect(diagnostics.typedUnpacks).toBe(0);
    } finally { runtime.dispose(); }
});

it('keeps Boolean-only bitmap stages on their native word traversal', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`use sequences
Base = array shape 1000000 fill false
Base (0 till 1000000 by 10000) = true
Total = 0
for Turn in 1 to 20
 Mask = Base equal true
 Result = Mask indices
 Total += Result sum
end`));
        expect(runtime.variables.get('Total')).toBe(990000000n);
        expect(diagnostics.numberLoops).toBe(0);
        expect(diagnostics.typedUnpacks).toBe(0);
    } finally { runtime.dispose(); }
});
