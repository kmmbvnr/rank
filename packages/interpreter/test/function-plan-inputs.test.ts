import { describe, expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, parse, type RankArray } from '../src/index.js';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt, InterruptedError } from '../src/interrupt.js';

const definition = `fun Input total
  Q' = Input * Input
  R = (Q + Input) sum
  return R
end`;

function run(source: string, compilation: boolean) {
    let calls = 0;
    const runtime = new Interpreter(undefined, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        try { return { value: formatValue(runtime.execute(source)!), calls }; }
        catch (error) { return { error: error instanceof RankError ? error.format() : String(error), calls }; }
    } finally { runtime.dispose(); }
}

describe('shared completed inputs in function plans', () => {
    it('shares one cell load across direct uses and named stages', () => {
        const fn = parse(definition).statements[0];
        if (!isFunctionStatement(fn)) throw Error('expected function');
        const kernel = compileScalarFunction(fn, [{ kind: 'array', element: 'integer', rank: 1 }], true)!;
        expect(kernel.source.match(/readArrayItem\(/g)).toHaveLength(1);
        expect(kernel.source.match(/for \(/g)).toHaveLength(1);
        expect(kernel.source).not.toContain('new Array');
    });

    it.each(['array 1 2 3', 'array (-3) 0 9', 'array 9007199254740993 2', 'array 1.5 2.5', 'array shape 0 fill 0'])
    ('matches exact and real arithmetic for %s', input => {
        const source = `${definition}\n(${input}) total`;
        const reference = run(source, false), compiled = run(source, true);
        expect({ ...compiled, calls: 0 }).toEqual(reference);
        expect(compiled.calls).toBeGreaterThan(0);
    });

    it('keeps each consumer and invocation independent of later writes', () => {
        const source = `${definition}\nA = array 1 2 3\nSaved = A\nFirst = A total\nA 0 = 9\nSecond = A total\nThird = Saved total\narray First Second Third`;
        expect(run(source, true)).toMatchObject({ value: '20 108 20' });
        expect({ ...run(source, true), calls: 0 }).toEqual(run(source, false));
    });

    it('does not mix input slots with different broadcast addresses', () => {
        const source = `fun A total B
  P' = A * B
  R = (P + A + B) sum
  return R
end
(array 1 2 3) total (array 10)`;
        expect(run(source, true)).toMatchObject({ value: '96', calls: 1 });
        expect({ ...run(source, true), calls: 0 }).toEqual(run(source, false));
    });

    it('keeps separately reduced consumers in their own loop bodies', () => {
        const source = `fun A total
  P' = A + A
  First = P sum
  Q' = A * A
  Second = Q sum
  return First + Second
end`;
        const fn = parse(source).statements[0];
        if (!isFunctionStatement(fn)) throw Error('expected function');
        const kernel = compileScalarFunction(fn, [{ kind: 'array', element: 'integer', rank: 1 }], true)!;
        expect(kernel.source.match(/readArrayItem\(/g)).toHaveLength(2);
        expect(run(`${source}\n(array 1 2 3) total`, true)).toMatchObject({ value: '26', calls: 1 });
    });

    it('shares a matrix input without sharing separate row-reduction bodies', () => {
        const source = `fun A total
  Left' = A sum rank 1
  Right' = A sum rank 1
  R = (Left + Right) sum
  return R
end
(array shape 2 3 fill 2) total`;
        expect(run(source, true)).toMatchObject({ value: '24', calls: 1 });
        expect({ ...run(source, true), calls: 0 }).toEqual(run(source, false));
    });

    it('does not reuse a cell at another outer-product address', () => {
        const source = `fun A total
  P' = A A outer *
  Rows' = P sum rank 1
  R = Rows sum
  return R
end
(array 1 2 3) total`;
        expect(run(source, true)).toMatchObject({ value: '36', calls: 1 });
        expect({ ...run(source, true), calls: 0 }).toEqual(run(source, false));
    });

    it('preserves arithmetic error locations after sharing a load', () => {
        const source = `fun A total
  Q' = A * A
  R = ((Q + A) // A) sum
  return R
end
(array 1 0 3) total`;
        const reference = run(source, false), compiled = run(source, true);
        expect(reference).toHaveProperty('error');
        expect({ ...compiled, calls: 0 }).toEqual(reference);
    });

    it('completes opaque inputs in ordinary read order before entry', () => {
        function observe(compilation: boolean) {
            const reads: number[] = [];
            let calls = 0;
            const runtime = new Interpreter(undefined, { compilation, onScalarFunctionExecuted: () => calls++ });
            const input: RankArray = { kind: 'array', shape: [3], items: [], itemAt: index => {
                reads.push(index);
                return BigInt(index + 1);
            } };
            try {
                runtime.variables.set('Input', input);
                return { value: formatValue(runtime.execute(`${definition}\nInput total`)!), reads, calls };
            } finally { runtime.dispose(); }
        }
        const reference = observe(false), compiled = observe(true);
        expect({ ...compiled, calls: 0 }).toEqual(reference);
        expect(compiled.reads).toEqual([0, 1, 2]);
    });

    it('honors cancellation and budgets when reusing a prepared consumer', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use sequences\n${definition}\nA = 1 to 4096 copy`);
            const expected = runtime.execute('A total');
            expect(withDemandBudget(100000, () => runtime.execute('A total'))).toBe(expected);
            expect(() => withDemandBudget(0, () => runtime.execute('A total'))).toThrow(DemandBudgetExhausted);
            const signal = new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => runtime.execute('A total'))).toThrow(InterruptedError);
            expect(runtime.execute('A total')).toBe(expected);
        } finally { runtime.dispose(); }
    });
});

it('compiles shared integer matrix broadcast stages', () => {
    const fill = '2';
    const source = `use sequences
fun A total B
 P' = A + B
 Q' = -P + P * B
 Rows' = Q sum rank 1
 Result = Rows sum
 return Result
end
A = array shape 4 1 fill ${fill}
B = array shape 7 fill ${fill}
A total B`;
    const compiled = run(source, true), reference = run(source, false);
    expect({ ...compiled, calls: 0 }).toEqual(reference);
    expect(compiled.calls).toBeGreaterThan(0);
});
it('retains shape failure locations inside matrix function plans', () => {
    const source = `fun A total B
 P' = A + B
 Rows' = P sum rank 1
 return Rows sum
end
A = array shape 4 3 fill 2
B = array shape 2 fill 3
A total B`;
    const compiled = run(source, true), reference = run(source, false);
    expect(reference).toHaveProperty('error');
    expect({ ...compiled, calls: 0 }).toEqual(reference);
});


it('keeps native arithmetic recipes across compiled array returns', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        const result = diagnostics.run(() => runtime.execute(`use sequences
Limit = 1000
fun Values scaled
  return (Limit // Values) * 1.0
end
fun Values weighted
  Part = (Limit // Values) * 1.0
  return Values * Part * (Part + 1.0) / 2.0
end
Values = 1 to 1000 copy
Scaled = Values scaled
Weighted = Values weighted
(Scaled + Weighted) sum`));
        const expected = Array.from({length: 1000}, (_, i) => {
            const value = i + 1, part = Math.floor(1000 / value);
            return part + value * part * (part + 1) / 2;
        }).reduce((a, b) => a + b, 0);
        expect(result).toBe(expected);
        expect(diagnostics.cellsComputed).toBe(0);
    } finally { runtime.dispose(); }
});

it.each([
    `fun Values quotient
  return 120 // Values
end
Result = (array 2 0 4) quotient
Result sum`,
    `fun Left combine Right
  return Left + Right
end
(array 1 2) combine (array 3 4 5)`,
    `fun Values shifted
  return Values * 2 + 1
end
Values = array 1 2 3
Result = Values shifted
Values 0 = 99
Result sum`,
    `fun Values shifted
  return Values * 2 + 1
end
(array shape 0 fill 0) shifted sum`,
])('preserves returned native recipe boundaries: %s', source => {
    expect({ ...run(source, true), calls: 0 }).toEqual(run(source, false));
});
