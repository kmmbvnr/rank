import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankSequence, withDemandBudget, withInterrupt } from '../src/index.js';

const setup = `use numbers
use sequences
A = 100 primesieve
B = primes from 5 to 7
`;

function run(source: string, compilation = true, exact = false) {
    const runtime = new Interpreter(undefined, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try { value = diagnostics.run(() => exact ? withDemandBudget(10000, () => formatValue(runtime.execute(source)!)) : formatValue(runtime.execute(source)!)); }
        catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
        return { value, error, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), compiled = run(source);
    expect({ value: compiled.value, error: compiled.error }).toEqual({ value: reference.value, error: reference.error });
    return compiled;
}

describe('Number scalar functions with guarded membership', () => {
    it('binds multiple readers independently, including short-circuit branches', () => {
        const result = compare(setup + `fun X helper
  if X equal 0
    return 3 in B
  end
  Count = 0
  for D in (-3) to X
    if D in A and D not in B
      Count += 1
    end
  end
  return Count greater 0
end
array (0 helper) (3 helper) (10 helper)`);
        expect(result.value).toBe('false true true');
        expect(result.diagnostics.numberFunctions).toBe(3);
        expect(result.diagnostics.numberFunctionFallbacks).toBe(0);
    });

    it.each(['2147483647', '(-2147483648)', '2147483648', '(-2147483649)', '9007199254740993', '(-9007199254740993)'])(
        'preserves membership of integer %s without truncation', value => {
            const result = compare(setup + `fun X helper
  return X not in A
end
${value} helper`);
            expect(result.value).toBe('true');
            if (value === '2147483648' || value === '(-2147483649)') {
                expect(result.diagnostics.numberFunctionFallbacks).toBe(1);
            }
        });

    it.each([
        ['2147483646 to 2147483647', '2147483647'],
        ['(-2147483647) to (-2147483648) by (-1)', '(-2147483648)'],
        ['2147483646 till 2147483647', '2147483646'],
        ['(-2147483647) till (-2147483648) by (-1)', '(-2147483647)'],
        ['2147483648 to 2147483649', '2147483649'],
        ['3 to (-1) by (-2)', '3'],
    ])('guards range and terminal increments: %s', (range, last) => {
        const result = compare(setup + `fun X helper
  Count = 0
  for D in ${range}
    if D not in A
      Count += 1
    end
    D = 99
  end
  return Count
end
${last} helper`);
        expect(result.error).toBeUndefined();
        if (range.startsWith('2147483646 to') || range.includes('to (-2147483648)') || range.startsWith('2147483648')) {
            expect(result.diagnostics.numberFunctionFallbacks).toBe(1);
        }
    });

    it('keeps checked arithmetic and exact private-write replay', () => {
        const result = compare(setup + `fun X helper
  Cells = array shape 2 fill 0
  Cells 0 = X
  if X in A
    Cells 1 = X * 9007199254740991
  end
  return (Cells 0) + (Cells 1)
end
Answer = 0
for Once in 1 to 1
  Answer = 2 helper
end
Answer`);
        expect(result.value).toBe(String(2n + 2n * 9007199254740991n));
        expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(result.diagnostics.numberFunctionFallbacks + result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('keeps real values and signed zero without narrowing', () => {
        for (const value of ['(-0.0)', '1.5', '2147483648.5']) {
            const result = compare(setup + `fun X helper
  if 3 not in A
    return 0.0
  end
  return X
end
${value} helper`);
            expect(result.diagnostics.numberFunctions).toBe(1);
            expect(result.diagnostics.numberFunctionFallbacks).toBe(0);
        }
    });

    it('retains located division errors and short-circuit evaluation', () => {
        for (const condition of ['3 in A', '4 in A']) {
            const source = setup + `fun X helper
  return ${condition} or (10 // X in B)
end
0 helper`;
            const result = run(source), exact = run(source, true, true);
            // Preserve the exact compiled kernel's located error and call frame.
            expect({ value: result.value, error: result.error }).toEqual({ value: exact.value, error: exact.error });
            expect(result.diagnostics.numberFunctions).toBe(1);
            if (condition.startsWith('3')) expect(result.value).toBe('true');
            else expect(result.error).toContain('division by zero');
        }
    });

    it('rechecks rebound, modified and forged sequence readers', () => {
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(setup + 'fun X helper\n return X in A\nend');
            expect(diagnostics.run(() => runtime.execute('7 helper'))).toBe(true);
            expect(diagnostics.numberFunctions).toBe(1);
            runtime.variables.set('A', runtime.execute('primes from 11 to 20')!);
            expect(runtime.execute('7 helper')).toBe(false);
            const value = runtime.variables.get('A')!;
            if (!isRankSequence(value)) throw new Error('expected sequence');
            const contains = value.plan.contains!;
            let calls = 0;
            value.plan.contains = () => { calls++; return true; };
            expect(diagnostics.run(() => runtime.execute('7 helper'))).toBe(true);
            expect(diagnostics.numberFunctions).toBe(1);
            expect(calls).toBe(1);
            value.plan.contains = contains;
            runtime.variables.set('A', { kind: 'sequence', plan: { ...value.plan, contains: () => { calls++; return true; } } });
            expect(runtime.execute('7 helper')).toBe(true);
            expect(calls).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('uses exact execution with observable polling or a demand budget', () => {
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(setup + `fun X helper
  Count = 0
  for D in 1 to X
    if D in A
      Count += 1
    end
  end
  return Count
end`);
            expect(runtime.execute('10 helper')).toBe(4n);
            const signal = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
            expect(diagnostics.run(() => withInterrupt(signal, () => runtime.execute('10 helper')))).toBe(4n);
            expect(diagnostics.run(() => withDemandBudget(1000, () => runtime.execute('10 helper')))).toBe(4n);
            expect(diagnostics.numberFunctions).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('links membership Number calls into a speculative numeric caller', () => {
        const result = compare(setup + `fun X helper
  return X in A and X not in B
end
Answer = 0
for I in 1 to 10
  if I helper
    Answer += I
  end
end
Answer`);
        expect(result.value).toBe('5');
        expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
        expect(result.diagnostics.numberFunctions).toBe(10);
    });

    it('publishes caller array writes before dependent membership reads', () => {
        const result = compare(`use sequences
A = array 11 13
fun X helper
  return X in A
end
Answer = 0
for I in 0 to 2
  A 0 = I
  if I helper
    Answer += 1
  end
end
Answer`);
        expect(result.value).toBe('3');
    });

    it('backs off wide membership inputs and recovers for small inputs', () => {
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(setup + 'fun X helper\n return X in A\nend');
            diagnostics.run(() => {
                for (let i = 0; i < 100; i++) expect(runtime.execute('2147483648 helper')).toBe(false);
            });
            expect(diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
            expect(diagnostics.numberFunctionSkips).toBeGreaterThan(80);
            diagnostics.run(() => {
                for (let i = 0; i < 300; i++) expect(runtime.execute('7 helper')).toBe(true);
            });
            expect(diagnostics.numberFunctions).toBeGreaterThan(100);
        } finally { runtime.dispose(); }
    });

    it('retains zero-step errors before any membership test', () => {
        const source = setup + `fun X helper
  Count = 0
  for D in 1 to X by 0
    if D in A
      Count += 1
    end
  end
  return Count
end
7 helper`;
        const compiled = run(source), exact = run(source, true, true);
        expect(compiled.error).toEqual(exact.error);
        expect(compiled.error).toContain('range step must be a nonzero integer');
    });

    it('honours disabled membership compilation', () => {
        const runtime = new Interpreter(undefined, { sequenceMembershipCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            expect(diagnostics.run(() => runtime.execute(setup + 'fun X helper\n return X in A\nend\n7 helper'))).toBe(true);
            expect(diagnostics.numberFunctions).toBe(0);
        } finally { runtime.dispose(); }
    });
});
