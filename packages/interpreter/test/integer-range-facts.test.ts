import { expect, it } from 'vitest';
import { withDemandBudget } from '../src/interrupt.js';
import { integerRangeFacts } from '../src/jit/integer-range-facts.js';
import { isForStatement, isAssignmentStatement, type Expression } from '@arrrank/language';
import { Interpreter, RuntimeDiagnostics, formatValue, parse } from '../src/index.js';

const initial = `use sequences
A = array shape 97 fill 0
Total = 9007199254740993`;
function run(body: string, compilation = true, setup = initial, budget?: number, options = {}) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(setup);
        let error: string | undefined;
        try { diagnostics.run(() => budget === undefined ? runtime.execute(body) : withDemandBudget(budget, () => runtime.execute(body))); }
        catch (failure) { error = String(failure); }
        return { diagnostics, state: { error, total: runtime.variables.get('Total'),
            array: formatValue(runtime.variables.get('A')!) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, setup = initial) {
    const result = run(source, true, setup);
    expect(result.state).toEqual(run(source, false, setup).state);
    return result;
}

it('narrows exact residues at a proved numeric boundary', () => {
    const result = compare(`for I in 0 till 100
 Index = Total mod 97
 A Index += 1
 Total += I
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.total).toBe(9007199254745943n);
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('uses different ranges for different definitions of one name', () => {
    const result = compare(`for I in 0 till 100
 X = I mod 8
 Y = X * X
 A Y += 1
 X = Total
 Total = X + I
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('merges bounded branch definitions before narrowing', () => {
    const result = compare(`for I in 0 till 100
 Divisor = 97
 if I mod 2 equal 0
  Divisor = 89
 end
 Index = Total mod Divisor
 A Index += 1
 Total += I
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('narrows negative floor remainders without truncating the dividend', () => {
    const result = compare(`for I in 0 till 100
 Index = -(Total mod -97)
 A Index += 1
 Total -= I
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('handles huge literals inside a bounded exact expression', () => {
    const result = compare(`for I in 0 till 100
 Index = (9007199254740993 + I) mod 97
 A Index += 1
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('invalidates loop-carried ranges before analyzing repeated definitions', () => {
    const result = compare(`X = 1
for I in 0 till 80
 X *= 2
 Total += X
 A (I mod 97) += 1
end`, initial.replace('9007199254740993', '0'));
    expect(result.state.error).toBeUndefined();
    expect(result.state.total).toBe((1n << 81n) - 2n);
});

it('does not export a body-only definition from an empty nested loop', () => {
    const result = compare(`X = Total
for I in 0 till 3
 for J in 0 till 0
  X = 1
 end
 A 0 = X
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.array.startsWith('9007199254740993 ')).toBe(true);
});

it('does not retain a bound across an unknown branch result', () => {
    const result = compare(`X = 1
for I in 0 till 3
 if I equal 1
  X = Total
 end
 A I = X
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.array.startsWith('1 9007199254740993 9007199254740993 ')).toBe(true);
});

it('retains partial stores before a zero divisor reached through a branch', () => {
    const result = compare(`for I in 0 till 4
 A 0 += 1
 Divisor = 31
 if I equal 2
  Divisor = 0
 end
 Index = (Total mod Divisor) mod 31
 A Index += 1
end`, initial.replace('shape 97', 'shape 32'));
    expect(result.state.error).toContain('division by zero');
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('replays overflow once before using a mixed exact region', () => {
    const result = compare(`for I in 0 till 12
 Index = Total mod 31
 A Index += 1
 Total *= 1000
end`, initial.replace('9007199254740993', '1').replace('shape 97', 'shape 32'));
    expect(result.state.error).toBeUndefined();
    expect(result.state.total).toBe(1000n ** 12n);
    expect(result.diagnostics.numberLoopOverflows).toBe(1);
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('does not give an earlier read the range of a later assignment', () => {
    const result = compare(`X = Total
for I in 0 till 3
 A I = X
 X = I mod 8
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.array.startsWith('9007199254740993 0 1 ')).toBe(true);
});

it('retains type errors for real operands at an integer boundary', () => {
    const result = compare(`for I in 0 till 3
 Index = Total mod 97
 A Index += 1
end`, initial.replace('9007199254740993', '1.5'));
    expect(result.state.error).toBeDefined();
});

it('keeps nested exact errors ahead of a safe outer remainder', () => {
    const result = compare(`for I in 0 till 3
 A 0 += 1
 Index = (Total mod 0) mod 31
 A Index += 1
end`, initial.replace('shape 97', 'shape 32'));
    expect(result.state.error).toContain('division by zero');
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('does not infer ranges from a previously observed array cell', () => {
    const result = compare(`for I in 0 till 3
 X = A 0
 A 0 = Total
 Total += X
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.total).toBe(27021597764222979n);
});

it('admits a mixed region when a wide literal excludes the all-Number plan', () => {
    const result = compare(`for I in 0 till 100
 X = I mod 8
 Y = X * X
 A Y += 1
 X = 9007199254740993
 Total = X + I
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.total).toBe(9007199254741092n);
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('retains demand-budget partial state on a new exact-to-Number boundary', () => {
    const source = `for I in 0 till 100
 Index = Total mod 31
 A Index += 1
 Total += I
end`;
    const setup = initial.replace('shape 97', 'shape 32');
    const result = run(source, true, setup, 10);
    expect(result.state).toEqual(run(source, true, setup, 10, { numberLoopCompilation: false }).state);
    expect(result.state.error).toContain('demand budget exhausted');
});

it('keeps an unbounded entry definition separate from later bounded assignments', () => {
    const result = compare(`for I in 0 till 100
 Index = Total mod 97
 A Index += 1
 Total = I
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.total).toBe(99n);
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
});

it('discards partial facts when range analysis exceeds its depth budget', () => {
    const loop = parse('for I in 0 till 2\n Index = Total mod 97\n X = 1\nend').statements[0];
    if (!isForStatement(loop)) throw new Error('expected loop');
    const [index, assignment] = loop.statements;
    if (!isAssignmentStatement(index) || !isAssignmentStatement(assignment)) throw new Error('expected assignments');
    const one = assignment.value;
    let value = one;
    for (let i = 0; i < 300; i++) value = { $type: 'BinaryExpression', operator: '+', left: value, right: one } as Expression;
    assignment.value = value;
    const facts = integerRangeFacts(loop);
    expect(facts.narrowing.size).toBe(0);
    expect(facts.values.get(index.value)).toBeUndefined();
    expect(facts.definitions.get(index)).toBeUndefined();
});
