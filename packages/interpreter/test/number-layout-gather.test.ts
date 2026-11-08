import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { readArrayItem, typedArray, ownedScalarArray } from '../src/array-storage.js';
import { prepareLayoutNumberTensor } from '../src/jit/tensor-number-layout.js';
import type { TensorNode } from '../src/jit/tensor-ir.js';

const floor = (a: bigint, b: bigint) => {
    const q = a / b, r = a % b;
    return r && (a < 0n) !== (b < 0n) ? q - 1n : q;
};
const input = (cells: Int32Array | BigInt64Array): TensorNode => ({ kind: 'input', value: typedArray(cells) });
const domains = (...nodes: TensorNode[]) => new Map(nodes.map(node => [node, ['integer'] as const]));

it('keeps safe floor division exact at signed boundaries and near multiples', () => {
    const numerators: bigint[] = [], divisors: bigint[] = [];
    const maximum = (1n << 53n) - 1n;
    for (const divisor of [1n, 2n, 3n, 7n, 31n, 1000001n, (1n << 31n) - 1n, 1n << 40n, maximum]) {
        for (const center of [0n, 1n, 1n << 31n, 1n << 40n, 1n << 52n, maximum]) {
            const multiple = center / divisor * divisor;
            for (const delta of [-1n, 0n, 1n]) for (const sign of [-1n, 1n]) for (const direction of [-1n, 1n]) {
                const a = (multiple + delta) * sign;
                if (a < -maximum || a > maximum) continue;
                numerators.push(a); divisors.push(divisor * direction);
            }
        }
    }
    const a = input(BigInt64Array.from(numerators)), b = input(BigInt64Array.from(divisors));
    const root: TensorNode = { kind: 'binary', op: '//', left: a, right: b };
    const run = prepareLayoutNumberTensor(root, domains(a, b, root), 'copy', new Map(), () => true)!;
    const result = run() as RankArray;
    expect(result).toBeDefined();
    expect(numerators.map((_, i) => readArrayItem(result, i))).toEqual(numerators.map((n, i) => floor(n, divisors[i])));
});

it.each([0, 1, 63, 64, 65, 4097])('validates a uniform checked layout once per nonempty demand (%i cells)', size => {
    const source = input(Int32Array.from({ length: size }, (_, i) => i));
    const seen: number[] = [];
    const root: TensorNode = { kind: 'check', source, uniform: true, validate(cell, index) { seen.push(index); return cell; } };
    const run = prepareLayoutNumberTensor(root, domains(source, root), 'copy', new Map(), () => true)!;
    const first = run() as RankArray, second = run() as RankArray;
    expect(first.shape).toEqual([size]);
    expect(second.shape).toEqual([size]);
    expect(seen).toEqual(size ? [0, 0] : []);
    if (size) expect(readArrayItem(second, size - 1)).toBe(BigInt(size - 1));
});

it('keeps nonuniform checks on every visited cell', () => {
    const source = input(new Int32Array(128).fill(3)), seen: number[] = [];
    const root: TensorNode = { kind: 'check', source, validate(cell, index) { seen.push(index); return cell; } };
    const run = prepareLayoutNumberTensor(root, domains(source, root), 'copy', new Map(), () => true)!;
    expect((run() as RankArray).shape).toEqual([128]);
    expect(seen).toEqual(Array.from({ length: 128 }, (_, i) => i));
});

it('validates the first selected position before entering a peeled loop', () => {
    const source = input(Int32Array.from({ length: 128 }, (_, i) => i)), seen: number[] = [];
    const root: TensorNode = { kind: 'check', source, uniform: true, validate(cell, index) { seen.push(index); return cell; } };
    const positions = Uint32Array.from({ length: 64 }, (_, i) => 127 - i);
    const run = prepareLayoutNumberTensor(root, domains(source, root), 'copy', new Map(), () => true, positions)!;
    const result = run() as RankArray;
    expect(seen).toEqual([127]);
    expect(readArrayItem(result, 0)).toBe(127n);
    expect(readArrayItem(result, 63)).toBe(64n);
});

for (const value of [3000000000n, (1n << 52n), (1n << 53n) + 1n]) it(`keeps repeated wide gathers exact for ${value}`, () => {
    const observe = (compilation: boolean) => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Input', typedArray(new BigInt64Array(128).fill(value)));
            const answer = diagnostics.run(() => runtime.execute(`use sequences\nuse numbers
Keys = (0 till 4096) mod 128
Values' = Input Keys
Values sum`));
            return { answer, diagnostics };
        } finally { runtime.dispose(); }
    };
    const actual = observe(true), expected = observe(false);
    expect(actual.answer).toBe(value * 4096n);
    expect(actual.answer).toBe(expected.answer);
    if (value <= (1n << 53n) - 1n) expect(actual.diagnostics.numberTensors).toBeGreaterThan(0);
});

it('admits equal-size native word sums without a conversion buffer', () => {
    const source = input(new BigInt64Array(128).fill(3000000000n));
    const run = prepareLayoutNumberTensor(source, domains(source), 'sum', new Map(), () => true);
    expect(run?.()).toBe(3000000000n * 128n);
});
it('retains the copy cap for equal-size boxed wide sums', () => {
    const source: TensorNode = { kind: 'input', value: ownedScalarArray(new Array(128).fill(1n << 100n), 'integer', [128]) };
    expect(prepareLayoutNumberTensor(source, domains(source), 'sum', new Map(), () => true)).toBeUndefined();
});
