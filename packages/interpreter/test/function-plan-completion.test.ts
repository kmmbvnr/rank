import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { integer32Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { wideScalarQuotients } from '../src/runtime/wide-scalar-quotients.js';
import { completeStoredBinary, sumStoredInteger } from '../src/runtime/function-plan-completion.js';
import { fusedModularProduct, modularProduct } from '../src/modular-fold.js';
import { Operators } from '../src/operators.js';
import { registerScalarView } from '../src/runtime/integer-view.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
const operators = new Operators(() => {}, () => undefined);
const binary = (op: string, a: any, b: any) => operators.evaluateBinary(op, a, b);
const cells = (value: any) => {
    if (!isRankArray(value)) throw Error('expected array');
    return Array.from({ length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));
};
const floor = (a: bigint, b: bigint) => a / b - (a % b !== 0n && (a < 0n) !== (b < 0n) ? 1n : 0n);

describe('wide scalar quotients', () => {
    const divisors = [1, -1, 2, -2, 3, -3, 7, -7, 31, -31, 65537, -65537, 2147483647, -2147483648];
    let state = 7654321;
    for (let i = 0; i < 2048; i++) { state = Math.imul(state, 1664525) + 1013904223 | 0; divisors.push(state || 1); }
    const source = typedArray(Int32Array.from(divisors));
    for (const power of [52n, 53n, 54n, 60n, 62n, 63n]) for (const offset of [-3n, -1n, 0n, 1n, 3n]) {
        for (const sign of [-1n, 1n]) {
            const numerator = sign * (2n ** power + offset);
            if (numerator < -(2n ** 63n) || numerator >= 2n ** 63n || numerator > -(2n ** 52n) && numerator < 2n ** 52n) continue;
            it(`matches exact signed division at ${numerator}`, () => {
                expect(cells(wideScalarQuotients(numerator, source))).toEqual(divisors.map(d => floor(numerator, BigInt(d))));
            });
        }
    }
    it('retains exact values around quotient boundaries', () => {
        for (const d of [3, 17, 65537, 2147483647, -2147483648]) for (const delta of [-1n, 0n, 1n]) {
            const n = BigInt(Math.abs(d)) * (2n ** 52n / BigInt(Math.abs(d)) + 123456789n) + delta;
            expect(cells(wideScalarQuotients(n, typedArray(Int32Array.of(d))))).toEqual([floor(n, BigInt(d))]);
        }
    });
    it('preserves shape and declines zero and out-of-range numerators', () => {
        const matrix = typedArray(Int32Array.of(2, 3, -7, 11), [2, 2]);
        expect(wideScalarQuotients(10n ** 16n, matrix)?.shape).toEqual([2, 2]);
        expect(cells(wideScalarQuotients(10n ** 16n, typedArray(new Int32Array(0))))).toEqual([]);
        expect(wideScalarQuotients(10n ** 16n, typedArray(Int32Array.of(2, 0)))).toBeUndefined();
        expect(wideScalarQuotients(2n ** 80n, matrix)).toBeUndefined();
    });
});

describe('stored function plan completion', () => {
    it('uses compact outputs and retains completed snapshots', () => {
        const source = typedArray(Int32Array.of(1, 2, 3));
        const result = completeStoredBinary('+', source, 1n, binary);
        expect(integer32Cells(result as any)).toBeDefined();
        expect(cells(result)).toEqual([2n, 3n, 4n]);
        source.items[0] = 100n;
        expect(cells(result)).toEqual([2n, 3n, 4n]);
        expect(completeStoredBinary('+', source, 1n, binary)).toBeUndefined();
    });
    it('sums signed Int32 extremes exactly across blocks', () => {
        const values = Int32Array.from({ length: 20000 }, (_, i) => i % 3 ? -2147483648 : 2147483647);
        expect(sumStoredInteger(typedArray(values))).toBe(Array.from(values).reduce((s, n) => s + BigInt(n), 0n));
        expect(sumStoredInteger(typedArray(new Int32Array(0)))).toBe(0n);
    });
    it('declines observable, shared, real and budgeted inputs without reading opaque cells', () => {
        let calls = 0;
        const opaque = { kind: 'array' as const, shape: [2], items: [], itemAt: () => { calls++; return 1n; } };
        const source = typedArray(Int32Array.of(1, 2));
        for (const input of [opaque, typedArray(Float64Array.of(1, 2)), typedArray(new Int32Array(new SharedArrayBuffer(8)))]) {
            expect(completeStoredBinary('+', input, 1n, binary)).toBeUndefined();
            expect(sumStoredInteger(input)).toBeUndefined();
            expect(wideScalarQuotients(10n ** 16n, input)).toBeUndefined();
        }
        expect(calls).toBe(0);
        expect(withDemandBudget(100, () => completeStoredBinary('+', source, 1n, binary))).toBeUndefined();
        expect(withDemandBudget(100, () => sumStoredInteger(source))).toBeUndefined();
        const flag = new Int32Array(new SharedArrayBuffer(4));
        expect(withInterrupt(flag, () => sumStoredInteger(source), () => {})).toBeUndefined();
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => wideScalarQuotients(10n ** 16n, typedArray(new Int32Array(8192).fill(3))))).toThrow('Interrupted');
    });
    it('preserves product-before-modulus effects on opaque inputs', () => {
        const events: string[] = [];
        const a = { kind: 'array' as const, shape: [1], items: [], itemAt: () => { events.push('cell'); return 3n; } };
        fusedModularProduct(a, a, () => { events.push('modulus'); return 7n; }, (op, left, right) => {
            events.push(op); return binary(op, left, right);
        });
        expect(events.indexOf('*')).toBeLessThan(events.indexOf('modulus'));
    });
    it('computes exact modular products near the Int32 limits', () => {
        const values = [-2147483648, -2147483647, -1, 0, 1, 2147483647];
        const a = typedArray(Int32Array.from(values)), b = typedArray(Int32Array.from(values.slice().reverse()));
        for (const m of [7n, 1000000007n, 2147483648n]) {
            expect(cells(modularProduct(a, b, m))).toEqual(values.map((n, i) => (BigInt(n) * BigInt(values[values.length - 1 - i]) % m + m) % m));
        }
    });
});

describe.each([false, true])('function arithmetic stage semantics (compilation=%s)', compilation => {
    function run(body: string) {
        const runtime = new Interpreter(() => {}, { compilation });
        try { return runtime.execute(`use sequences\n${body}`); } finally { runtime.dispose(); }
    }
    it('keeps unused deferred divisions unevaluated', () => {
        expect(run(`fun Values helper\n  Unused' = Values // 0\n  return 19\nend\n(1 to 3 copy) helper`)).toBe(19n);
    });
    it('keeps empty array division empty', () => {
        expect(cells(run(`fun Values helper\n  Result = Values // 0\n  return Result\nend\n(1 till 1 copy) helper`))).toEqual([]);
    });
    it('preserves scalar preparation errors for empty deferred consumers', () => {
        expect(() => run(`fun Values helper\n  Result' = Values + 1 // 0\n  return Result sum\nend\n(1 till 1 copy) helper`)).toThrow('division by zero');
    });
    it('retains ordinary completion errors and exact overflowing products', () => {
        expect(() => run(`fun Values helper\n  Result = Values // 0\n  return 19\nend\n(1 to 3 copy) helper`)).toThrow('division by zero');
        expect(cells(run(`fun Values helper\n  Result = Values * 10000000000000000\n  return Result\nend\n(1 to 3 copy) helper`))).toEqual([10n ** 16n, 2n * 10n ** 16n, 3n * 10n ** 16n]);
    });
    it('lowers modular products and repeated completed stages', () => {
        expect(run(`fun Values helper\n  Next = Values + 1\n  Products = Values * Next mod 1000000007\n  Parity = Products mod 2\n  Terms = Products + Parity\n  return Terms sum\nend\n(1 to 10000 copy) helper`)).toBe(333433340000n);
    });
});

it('completes compact stages in an executed exact function kernel', () => {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.variables.set('Input', typedArray(Int32Array.of(1, 2, 3)));
        const result = runtime.execute('fun Values helper\n  Next = Values + 1\n  return Next\nend\nInput helper');
        expect(calls).toBeGreaterThan(0);
        expect(integer32Cells(result as any)).toBeDefined();
        expect(cells(result)).toEqual([2n, 3n, 4n]);
    } finally { runtime.dispose(); }
});
it('does not read opaque array headers in native completion admission', () => {
    let reads = 0;
    const value = { kind: 'array' as const, get shape() { reads++; return [2]; }, items: [1n, 2n] };
    expect(sumStoredInteger(value)).toBeUndefined();
    expect(completeStoredBinary('+', value, 1n, binary)).toBeUndefined();
    expect(reads).toBe(0);
});

it('borrows signed-stride views for division, modular products and sums', () => {
    const source = typedArray(Int32Array.of(3, 5, -7, 11, 17));
    const view = registerScalarView({ kind: 'array', shape: [3], items: [],
        itemAt: i => readArrayItem(source, 4 - 2 * i) }, source, i => 4 - 2 * i,
        { linear: () => ({ offset: 4, stride: -2 }) });
    expect(sumStoredInteger(view)).toBe(13n);
    expect(cells(wideScalarQuotients(10n ** 16n, view))).toEqual([17n, -7n, 3n].map(d => floor(10n ** 16n, d)));
    expect(cells(modularProduct(view, view, 97n))).toEqual([95n, 49n, 9n]);
    expect(cells(completeStoredBinary('+', view, 1n, binary))).toEqual([18n, -6n, 4n]);
});
it('retains product shape errors before resolving a deferred modulus', () => {
    const a = typedArray(Int32Array.of(1, 2)), b = typedArray(Int32Array.of(3, 4, 5));
    let loaded = false;
    expect(() => fusedModularProduct(a, b, () => { loaded = true; return 7n; }, binary)).toThrow();
    expect(loaded).toBe(false);
});

it('keeps materialized modular products compact inside scalar function loops', () => {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('Input', typedArray(Int32Array.of(-2147483648, 2147483647)));
        const value = runtime.execute(`use sequences
fun Values helper Modulus
 for Pass in 1 to 2
  Values = Values * Values mod Modulus copy
 end
 return Values
end
Input helper 1000000007`);
        expect(integer32Cells(value as any)).toBeDefined();
        expect(cells(value)).toEqual([-2147483648n, 2147483647n].map(n => n ** 4n % 1000000007n));
    } finally { runtime.dispose(); }
});
