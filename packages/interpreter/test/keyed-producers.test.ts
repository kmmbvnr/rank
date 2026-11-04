import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

for (const compilation of [true, false]) {
    for (const operation of ['+', '*', 'min', 'max']) {
        for (const kind of ['reduce', 'scan']) {
            it(`streams wide integer ${kind} ${operation} (${compilation})`, () => {
                const runtime = new Interpreter(() => {}, { compilation });
                const diagnostics = new RuntimeDiagnostics();
                const seed = 9007199254740993n;
                const states = Array(5).fill(seed) as bigint[];
                const prefixes: bigint[] = [];
                for (let i = 0n; i < 50n; i++) {
                    const key = Number((i * i + 3n) % 5n);
                    const value = i * 1000000000000001n - seed;
                    const previous = states[key];
                    states[key] = operation === '+' ? previous + value : operation === '*' ? previous * value
                        : operation === 'min' ? previous < value ? previous : value : previous > value ? previous : value;
                    prefixes.push(states[key]);
                }
                try {
                    runtime.execute(`use sequences
T = 0 till 50 array
Values' = T * 1000000000000001 - ${seed}
Keys' = (T * T + 3) mod 5`);
                    for (let demand = 0; demand < 2; demand++) {
                        const result = diagnostics.run(() => runtime.execute(
                            `Values ${kind} ${operation} by Keys with ${seed} size 5`));
                        if (!result || !isRankArray(result)) throw new Error('expected array');
                        const expected = kind === 'scan' ? prefixes : states;
                        expect(result.shape).toEqual([expected.length]);
                        expect(expected.map((_, i) => readArrayItem(result, i))).toEqual(expected);
                    }
                    expect(diagnostics.integerKeyedFolds).toBe(2);
                    expect(diagnostics.keyedNativeReaders).toBe(4);
                    expect(diagnostics.typedArrayPublishedCells).toBeLessThanOrEqual(100);
                } finally { runtime.dispose(); }
            });
        }
    }

    it(`keeps key errors before value reads (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`A = array 0 1
Values' = 1 // A
Keys' = A - 1`);
            expect(() => runtime.execute('Values reduce + by Keys')).toThrow(/nonnegative integer/);
            runtime.execute("Keys' = A + 4294967295");
            expect(() => runtime.execute('Values reduce + by Keys')).toThrow(/nonnegative integer/);
            runtime.execute("Keys' = A + 2");
            expect(() => runtime.execute('Values reduce + by Keys size 2')).toThrow(/outside the result size/);
            runtime.execute("Keys' = A + 0");
            expect(() => runtime.execute('Values reduce + by Keys')).toThrow(/division by zero/);
        } finally { runtime.dispose(); }
    });

    it(`repeats effectful reducers for each demand (${compilation})`, () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`use io
fun A tracked B
 B print
 return A + B
end
T = array 0 1 2
Values' = T * 9007199254740993 + 1
Keys' = T mod 2`);
            for (let demand = 0; demand < 2; demand++) {
                expect(diagnostics.run(() => runtime.execute('(Values reduce tracked by Keys with 0) sum')))
                    .toBe(27021597764222982n);
            }
            expect(output).toHaveLength(6);
            expect(output.slice(0, 3)).toEqual(output.slice(3));
            expect(diagnostics.keyedNativeReaders).toBe(0);
        } finally { runtime.dispose(); }
    });

    it(`retains opaque host reads in key/value order (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        const reads: string[] = [];
        const array = (name: string, cells: bigint[]) => ({
            kind: 'array' as const, shape: [cells.length], items: cells,
            itemAt(index: number) { reads.push(`${name}${index}`); return cells[index]; },
        });
        try {
            runtime.variables.set('V', array('v', [10n, 20n, 30n]));
            runtime.variables.set('K', array('k', [0n, 1n, 0n]));
            expect(diagnostics.run(() => runtime.execute('(V reduce + by K) sum'))).toBe(60n);
            expect(reads).toEqual(['k0', 'v0', 'k1', 'v1', 'k2', 'v2']);
            expect(diagnostics.keyedNativeReaders).toBe(0);
        } finally { runtime.dispose(); }
    });

    it(`keeps completed assignments and aliases (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`A = array 1 2 3
Alias = A
Values = A * 9007199254740993
A 0 = 99
Keys' = Alias mod 2`);
            const result = runtime.execute('Values reduce + by Keys with 0');
            if (!result || !isRankArray(result)) throw new Error('expected array');
            expect([readArrayItem(result, 0), readArrayItem(result, 1)])
                .toEqual([18014398509481986n, 36028797018963972n]);
        } finally { runtime.dispose(); }
    });

    it(`honors bounded demand and cancellation (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`use sequences
T = 0 till 10000 array
Values' = T * T + 1
Keys' = T mod 13
Saved = 123`);
            expect(() => diagnostics.run(() => withDemandBudget(100,
                () => runtime.execute('Saved = Values sum by Keys size 13')))).toThrow(DemandBudgetExhausted);
            expect(diagnostics.keyedNativeReaders).toBe(0);
            expect(runtime.execute('Saved')).toBe(123n);
            const flag = new Int32Array(new SharedArrayBuffer(4));
            flag[0] = 1;
            expect(() => withInterrupt(flag, () => runtime.execute('Saved = Values sum by Keys size 13')))
                .toThrow(/Interrupted/);
            expect(runtime.execute('Saved')).toBe(123n);
            expect(runtime.execute('(Values sum by Keys size 13) sum')).toBe(333283345000n);
        } finally { runtime.dispose(); }
    });
}
