import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

const size = 262200;
const prefix = `use sequences
Size = ${size}
A = array shape Size fill 0
Alias = A
Round = 0`;
function run(body: string, options = {}, budget?: number) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        runtime.execute(prefix);
        const execute = () => runtime.execute(`for Round less 1\n${body}\n Round += 1\nend`);
        try { diagnostics.run(() => budget === undefined ? execute() : withDemandBudget(budget, execute)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { error, round: runtime.variables.get('Round'),
            total: runtime.execute('A sum'), alias: runtime.execute('Alias sum'),
            first: runtime.execute('A 0'), last: runtime.execute(`A ${size - 1}`) } };
    } finally { runtime.dispose(); }
}
function compare(body: string, budget?: number) {
    const result = run(body, {}, budget);
    expect(result.state).toEqual(run(body, { compilation: false }, budget).state);
    expect(result.state).toEqual(run(body, { numberLoopCompilation: false }, budget).state);
    return result;
}
const nested = ` Rows = 3
 Columns = Size // Rows
 for Row in 0 till Rows
  for Col in 0 till Columns
   A (Row * Columns + Col) = Row * Columns + Col
  end
 end`;

it('composes invariant nested work after local bound definitions', () => {
    const result = compare(nested);
    expect(result.state).toEqual({ error: undefined, round: 1n, alias: 0n,
        first: 0n, last: BigInt(size - 1), total: BigInt(size) * BigInt(size - 1) / 2n });
    expect(result.diagnostics.numberLoops).toBe(1);
    expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
    expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeUndefined();
});

it('composes selected branches, scalar definitions and strided stores', () => {
    const result = compare(` if Round equal 0
  End = Size - 1
  A (0 to End by 2) = 3
  A (1 to End by 2) = 4
 else
  A 0 = 99
 end`);
    expect(result.state.total).toBe(BigInt(size / 2) * 7n);
    expect(result.state.alias).toBe(0n);
    expect(result.diagnostics.numberLoops).toBe(1);
    expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
});

it('does not multiply a bound that changes across the back edge', () => {
    const result = compare(nested.replace('  for Col', '  Columns = Columns // 2\n  for Col'));
    expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
});

it('does not infer branch selection or bounds from array cells', () => {
    const result = compare(` if A 0 equal 0
  End = A 1
  for I in 0 till End
   A I = I
  end
 end`);
    expect(result.state.total).toBe(0n);
    expect(result.diagnostics.numberLoops).toBe(0);
    expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
});

it('replays exact overflow and publishes preceding stores before errors', () => {
    const result = compare(nested.replace('= Row * Columns + Col', '= 9007199254740991 + Row * Columns + Col')
        + '\n A Size = 1');
    expect(result.state.error).toContain('array index out of bounds');
    expect(result.state.last).toBe(9007199254740991n + BigInt(size - 1));
    expect(result.state.alias).toBe(0n);
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});

it('retains observable demand boundaries for newly admitted regions', () => {
    const result = run(nested, {}, 200);
    expect(result.state).toEqual(run(nested, { numberLoopCompilation: false }, 200).state);
    expect(result.state.error).toContain('demand budget exhausted');
    expect(result.diagnostics.numberLoops).toBe(0);
});
