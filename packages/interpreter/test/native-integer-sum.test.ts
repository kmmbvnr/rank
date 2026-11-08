import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, parse } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { prepareNativeIntegerSum } from '../src/native-integer-sum.js';
import { withDemandBudget, withInterrupt, InterruptedError } from '../src/interrupt.js';
import type { NativeFunction, RankArray } from '../src/value.js';

function floor(n: bigint, d: bigint) {
    const q = n / d, r = n % d;
    return r && (r < 0n) !== (d < 0n) ? q - 1n : q;
}
function run(source: string, a: RankArray, compilation = false, b?: RankArray) {
    const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
    runtime.variables.set('A', a);
    if (b) runtime.variables.set('B', b);
    try {
        diagnostics.run(() => runtime.execute(`Result = ${source}`));
        return { result: runtime.variables.get('Result'), diagnostics };
    } finally { runtime.dispose(); }
}

it.each([false, true])('sums integer arithmetic and floor quotients on tensors (compilation=%s)', compilation => {
    const cells = [1, 2, 7, 11, 13, 31];
    for (const sign of [1n, -1n]) for (const denominator of [1n, -1n]) {
        const n = 1000000000000n * sign;
        const a = ownedArray(cells.map(BigInt), [2, 3]);
        const b = typedArray(Int32Array.from(cells, x => Number(denominator) * (x + 3)), [2, 3]);
        const result = run(`(${n} // (A * B + ${denominator * 3n}) - A) sum`, a, compilation, b);
        expect(result.result).toBe(cells.reduce((sum, x) => sum + floor(n, BigInt(x) * denominator * BigInt(x + 3) + denominator * 3n) - BigInt(x), 0n));
        if (!compilation) expect(result.diagnostics.nativeIntegerSums).toBeGreaterThan(0);
    }
});
it('accumulates an exact total above Number without rounding intermediate cells', () => {
    const cells = [4000000000000000n, 4000000000000001n, -1n, 4000000000000003n];
    const result = run('(A * 2 + 1) sum', typedArray(BigInt64Array.from(cells)));
    expect(result.result).toBe(cells.reduce((s, x) => s + x * 2n + 1n, 0n));
    expect(result.diagnostics.nativeIntegerSums).toBe(1);
});
it.each([9007199254740991n, 9007199254740992n, 1n << 100n])('replays exact arithmetic for unsafe intermediate %s', wide => {
    const cells = [1n, 2n, 3n, 4n];
    const result = run(`(A * ${wide} - A * ${wide - 1n}) sum`, ownedArray(cells));
    expect(result.result).toBe(10n);
    expect(result.diagnostics.nativeIntegerSums).toBe(0);
});
it('keeps large floor numerators on exact division', () => {
    const n = 9007199254740993n, cells = [3n, -7n, 1n];
    const result = run(`(${n} // A) sum`, ownedArray(cells));
    expect(result.result).toBe(cells.reduce((s, x) => s + floor(n, x), 0n));
    expect(result.diagnostics.nativeIntegerSums).toBe(0);
});
it('returns an empty sum but still evaluates scalar-only errors', () => {
    expect(run('(A * 2 + 1) sum', typedArray(new Int32Array(), [2, 0])).result).toBe(0n);
    expect(() => run('(A * 2 + (1 // 0)) sum', typedArray(new Int32Array(), [2, 0]))).toThrow('division by zero');
    expect(run('(A // 0) sum', typedArray(new Int32Array(), [2, 0])).result).toBe(0n);
});
it('preserves zero division and shape errors', () => {
    expect(() => run('(A // B) sum', ownedArray([1n, 2n]), false, ownedArray([1n, 0n]))).toThrow('division by zero');
    expect(() => run('(A * 2 + B) sum', ownedArray([1n, 2n]), false, ownedArray([1n, 2n, 3n]))).toThrow();
});
it('does not fuse across an ordinary binding or change its snapshot', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    try {
        runtime.execute('use sequences\nA = 1 to 3 copy\nTemp = A * 2\nA 0 = 99\nResult = (Temp + 1) sum');
        expect(runtime.variables.get('Result')).toBe(15n);
        expect(formatValue(runtime.variables.get('Temp')!)).toBe('2 4 6');
        expect(() => runtime.execute('Bad = Temp // (Temp - 2)\nUnused = 0')).toThrow('division by zero');
    } finally { runtime.dispose(); }
});
it('rechecks warmed sum identity and evaluates its argument before host dispatch', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    runtime.variables.set('A', ownedArray([1n, 2n]));
    runtime.variables.set('Zero', 1n);
    const program = parse('Result = (A * 2 + (1 // Zero)) sum');
    try {
        runtime.executeProgram(program);
        expect(runtime.variables.get('Result')).toBe(8n);
        let calls = 0;
        const replacement: NativeFunction = { kind: 'function', name: 'sum', arities: [1], monadicRank: 'all', call: () => { calls++; return 77n; } };
        runtime.variables.set('sum', replacement);
        runtime.executeProgram(program);
        expect(runtime.variables.get('Result')).toBe(77n);
        expect(calls).toBe(1);
        runtime.variables.set('Zero', 0n);
        expect(() => runtime.executeProgram(program)).toThrow('division by zero');
        expect(calls).toBe(1);
    } finally { runtime.dispose(); }
});
it('does not read a replaced native call getter before argument errors', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    runtime.variables.set('A', ownedArray([1n, 2n]));
    runtime.variables.set('Zero', 1n);
    const program = parse('Result = (A * 2 + (1 // Zero)) sum');
    try {
        runtime.executeProgram(program);
        const fn = runtime.execute('sum') as NativeFunction, original = fn.call;
        let reads = 0;
        Object.defineProperty(fn, 'call', { configurable: true, get: () => { reads++; return original; } });
        runtime.variables.set('Zero', 0n);
        expect(() => runtime.executeProgram(program)).toThrow('division by zero');
        expect(reads).toBe(0);
    } finally { runtime.dispose(); }
});
it('declines foreign storage without invoking its getters', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    const source = parse('Result = (A * 2 + 1) sum').statements[0];
    if (source.$type !== 'AssignmentStatement') throw Error('assignment');
    const expression = source.value as import('@arrrank/language').ApplicationExpression;
    let reads = 0;
    const foreign = { kind: 'array', shape: [2], get items() { reads++; throw Error('host items'); } } as unknown as RankArray;
    const kernel = prepareNativeIntegerSum(expression.head, () => foreign)!;
    expect(kernel()).toBeUndefined();
    expect(reads).toBe(0);
    runtime.dispose();
});
it('rechecks demand and opaque host polling on a warmed expression', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    runtime.variables.set('A', ownedArray([1n, 2n, 3n]));
    const program = parse('Result = (A * 2 + 1) sum');
    try {
        runtime.executeProgram(program);
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => withDemandBudget(10000, () => runtime.executeProgram(program)));
        expect(runtime.variables.get('Result')).toBe(15n);
        expect(diagnostics.nativeIntegerSums).toBe(0);
        const host = { length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {} };
        diagnostics.run(() => withInterrupt(host, () => runtime.executeProgram(program)));
        expect(runtime.variables.get('Result')).toBe(15n);
        expect(diagnostics.nativeIntegerSums).toBe(0);
    } finally { runtime.dispose(); }
});
it('polls long successful reads for cancellation', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    runtime.variables.set('A', typedArray(new Int32Array(8192).fill(3)));
    const statement = parse('Result = (A * 2 + 1) sum').statements[0];
    if (statement.$type !== 'AssignmentStatement') throw Error('assignment');
    const expression = statement.value as import('@arrrank/language').ApplicationExpression;
    const kernel = prepareNativeIntegerSum(expression.head, name => runtime.variables.get(name))!;
    try { expect(() => withInterrupt(new Int32Array([1]), kernel)).toThrow(InterruptedError); }
    finally { runtime.dispose(); }
});

it.each([4503599627370495n, -4503599627370495n, 4503599627370496n, 9007199254740991n])('checks floor boundaries at numerator %s against BigInt', numerator => {
    const denominators = [2147483647n, -2147483648n, 3n, -3n, 1n, -1n, 9007199254740991n];
    const result = run(`(${numerator} // (A + 0)) sum`, typedArray(BigInt64Array.from(denominators)));
    expect(result.result).toBe(denominators.reduce((sum, d) => sum + floor(numerator, d), 0n));
    expect(result.diagnostics.nativeIntegerSums).toBe(numerator < 4503599627370496n ? 1 : 0);
});
it('checks quotients on either side of an integer boundary', () => {
    for (const quotient of [2147483647n, -2147483648n]) for (const divisor of [1048573n, -1048573n]) for (const delta of [-1n, 0n, 1n]) {
        const numerator = quotient * divisor + delta;
        const result = run(`(${numerator} // A) sum`, ownedArray([divisor, -divisor]));
        expect(result.result).toBe(floor(numerator, divisor) + floor(numerator, -divisor));
        expect(result.diagnostics.nativeIntegerSums).toBe(1);
    }
});

it('retains ordinary snapshots for externally shared numeric buffers', () => {
    const array = typedArray(new Int32Array(new SharedArrayBuffer(16)).fill(3));
    const result = run('(A * 2 + A) sum', array);
    expect(result.result).toBe(36n);
    expect(result.diagnostics.nativeIntegerSums).toBe(0);
});

it('refreshes input shape, representation and numeric kind on a warmed expression', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    const statement = parse('Result = (A * 2 + 1) sum').statements[0];
    if (statement.$type !== 'AssignmentStatement') throw Error('assignment');
    const compact = typedArray(Int32Array.of(1, 2));
    try {
        runtime.variables.set('A', compact);
        expect(runtime.evaluate(statement.value)).toBe(8n);
        compact.items[0] = 99n;
        expect(runtime.evaluate(statement.value)).toBe(204n);
        runtime.variables.set('A', typedArray(BigInt64Array.of(3000000000n, 4n, 5n), [3, 1]));
        expect(runtime.evaluate(statement.value)).toBe(6000000021n);
        runtime.variables.set('A', ownedArray([1.25, 2.5]));
        expect(runtime.evaluate(statement.value)).toBe(9.5);
    } finally { runtime.dispose(); }
});

it.each([false, true])('keeps large products on the compiled tensor path when enabled (%s)', compilation => {
    const a = Int32Array.from({length: 8192}, (_, i) => i - 4000);
    const b = BigInt64Array.from(a, value => BigInt(value) * 1000n);
    const result = run('(A * B) sum', typedArray(a), compilation, typedArray(b));
    expect(result.result).toBe(a.reduce((sum, value, i) => sum + BigInt(value) * b[i], 0n));
    expect(result.diagnostics.nativeIntegerSums).toBe(compilation ? 0 : 1);
    if (compilation) expect(result.diagnostics.compiledTensors).toBeGreaterThan(0);
});
