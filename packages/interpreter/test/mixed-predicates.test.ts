import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, type InterpreterOptions } from '../src/index.js';
import { withInterrupt, withDemandBudget } from '../src/interrupt.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics(), output: string[] = [];
    const runtime = new Interpreter(text => output.push(text), { scalarEntryCompilation: false, ...options });
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error, output, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = execute(source);
    expect(result.observation).toEqual(execute(source, { compilation: false }).observation);
    expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    return result;
}
const prefix = `fun N build Base
  A = array shape N fill 0
  P = Base
  for I in 0 till N
    A I = I + 1
    P += 2
    if P greater Base
      A I += 1
    end
  end
  Total = 0
  for J in 0 till N
    Total += A J * P
  end
  return Total
end`;

describe('wide integer predicates with checked numeric storage', () => {
    it.each([['9007199254740990', 'Base + 5', 'less', '+='], ['-9007199254740990', 'Base - 5', 'greater', '-=']])(
        'crosses the safe boundary in a predicate-only counter: %s', (start, stop, op, update) => {
            const result = compare(`A = array shape 8 fill 0
Saved = A
P = ${start}
Base = P
I = 0
for P ${op} ${stop}
 A I = I + 1
 P ${update} 1
 I += 1
end`);
            expect(result.observation.error).toBeUndefined();
            expect(result.diagnostics.mixedIntegerLoops).toBe(1);
            expect(result.diagnostics.numberLoopOverflows).toBe(1);
        });

    it.each([
        'if P greater Base\n A I = 2\nelif P equal Base\n A I = 3\nelse\n A I = 4\nend',
        'if P * 3 - P * 3 equal 0\n A I = 7\nend',
        'if P greater Base or (1 // 0 greater 0)\n A I = 5\nend',
        'if P less Base and (1 // 0 greater 0)\n A I = 5\nend',
        'if P greater 0.5 and Flag\n A I = 6\nend',
    ])('preserves exact branch arithmetic and boolean evaluation: %s', condition => {
        const result = compare(`A = array 0 0 0\nBase = 9007199254740993\nP = Base\nFlag = true\nfor I in 0 to 2\n P += 1\n ${condition.replace(/\n/g, '\n ')}\nend`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    });

    it.each(['P bit I and P greater Base', '(P binary len) greater 0'])('keeps audited exact consumers inside a wide predicate: %s', predicate => {
        const result = compare(`use bits\nA = array 0 0 0\nBase = 9007199254740993\nP = Base\nfor I in 0 to 2\n P += 1\n if ${predicate}\n  A I = I + 1\n end\nend`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    });

    it.each([
        'use numbers\nP = 9007199254740993\nfor I in 0 to 1\n if (P isqrt) greater 0\n  Last = I\n end\nend',
        'P = 9007199254740993\nfor I in 0 to 1\n B = P greater 0\n if B\n  Last = I\n end\nend',
        'P = 9007199254740993\nfor I in 1 to P by P\n Last = I\nend',
        'P = 9007199254740993\nA = array 0 0\nfor I in 0 to 1\n A (P - 9007199254740993 + I) = 7\nend',
        'P = 9007199254740993\nA = array 0 0\nfor I in 0 to 1\n A I = P\nend',
    ])('retains exact fallback for unsupported wide consumers: %s', source => {
        const result = compare(source);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(0);
    });

    it('publishes the completed exact bindings and COW writes at the original error', () => {
        const result = compare(`A = array 0 0 0
Saved = A
Base = 9007199254740993
P = Base
I = 0
for P less Base + 5
 A I = I + 1
 P += 1
 Before = P
 Bad = 10 // (1 - I)
 I += 1
end`);
        expect(result.observation.error).toContain('division by zero');
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    });

    it('retries a fresh-array function prefix after scalar overflow without duplicate stores', () => {
        const result = compare(`${prefix}\nActual = 3 build 9007199254740990`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Actual', '81064793292668964']);
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it('rebinds safe, wide, empty and negative frames on repeated helper calls', () => {
        const result = compare(`${prefix}
First = 3 build 9007199254740993
Empty = 0 build 9007199254740993
Safe = 2 build 3
Last = 2 build -9007199254740993`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Safe', '35']);
        expect(result.observation.variables).toContainEqual(['Empty', '0']);
        expect(result.diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    });

    it('preserves returned local arrays and snapshots across mixed helper calls', () => {
        const source = prefix.replace('return Total', 'return A');
        const result = compare(`${source}\nFirst = 3 build 9007199254740993\nNext = 2 build 9007199254740993\nSaved = First\nFirst 0 = 9`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Saved', '2 3 4']);
        expect(result.observation.variables).toContainEqual(['Next', '2 3']);
        expect(result.diagnostics.mixedIntegerLoops).toBe(2);
    });

    it('retains exact error locations and call traces after a mixed helper prefix', () => {
        const source = prefix.replace('Total += A J * P', 'Total += A J * P\n    Bad = 1 // (N - J - 1)');
        const result = compare(`${source}\nActual = 3 build 9007199254740993`);
        expect(result.observation.error).toContain('division by zero');
        expect(result.diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    });

    it('leaves an unused deferred failure untouched in a wide helper', () => {
        const source = prefix.replace('  P = Base', "  Unused' = 1 // 0\n  P = Base");
        expect(compare(`${source}\nActual = 3 build 9007199254740993`).observation.error).toBeUndefined();
    });

    it('does not reuse a mixed helper plan with stale captures', () => {
        const source = prefix.replace('fun N build Base', 'fun N build');
        const result = compare(`Base = 9007199254740993\n${source}\nFirst = 2 build\nBase = -9007199254740993\nLast = 2 build`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.mixedIntegerLoops).toBe(2);
    });

    it('keeps alias snapshots when a local alias prevents prefix fusion', () => {
        const source = prefix.replace('  Total = 0', '  Saved = A\n  Total = 0').replace('    Total += A J * P', '    A J += 1\n    Total += A J * P').replace('return Total', 'return Saved');
        const result = compare(`${source}\nActual = 3 build 9007199254740993`);
        expect(result.observation.error).toBeUndefined();
        expect(result.observation.variables).toContainEqual(['Actual', '2 3 4']);
    });

    it('publishes wide predicate progress and runs finally on cancellation', () => {
        const flag = new Int32Array(1); flag[0] = 1;
        const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`A = array shape 4096 fill 0
Saved = A
Base = 9007199254740993
P = Base
I = 0
Done = 0
try
 for P less Base + 1000000
  A (I mod 4096) += 1
  I += 1
  P += 1
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            const count = runtime.variables.get('I') as bigint;
            expect(count).toBeGreaterThan(0n);
            expect(runtime.variables.get('P')).toBe(9007199254740993n + count);
            expect(runtime.execute('A sum')).toBe(count);
            expect(runtime.execute('Saved sum')).toBe(0n);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.mixedIntegerLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('cancels a private mixed helper and executes the caller finally', () => {
        const diagnostics = new RuntimeDiagnostics(), flag = new Int32Array(1);
        const runtime = new Interpreter(() => {}, { onIntegerLoopCompiled: () => { Atomics.store(flag, 0, 1); } });
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`${prefix}\nDone = 0\ntry\n Actual = 1000000 build 9007199254740993\nfinally\n Done = 1\nend`)))).toThrow('Interrupted');
            expect(runtime.variables.has('Actual')).toBe(false);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.mixedIntegerLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('retains demand-budget cancellation in a mixed helper', () => {
        const runtime = new Interpreter(() => {});
        try {
            expect(() => withDemandBudget(100, () => runtime.execute(`${prefix}\nActual = 1000000 build 9007199254740993`))).toThrow('demand budget exhausted');
        } finally { runtime.dispose(); }
    });
});
