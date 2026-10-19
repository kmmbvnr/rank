import { describe, expect, it, vi } from 'vitest';
import { Interpreter, formatValue, parse, type RankValue } from '../src/index.js';
import { isForStatement } from '@arrrank/language';
import { ownedArray } from '../src/array-storage.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { withInterrupt } from '../src/interrupt.js';
import { ArrayBindingContract } from '../src/array-binding-contract.js';
import { sliceSource } from '../src/slice-source.js';

function run(source: string, tensorFusion: boolean) {
    let kernels = 0, compiled = 0;
    const runtime = new Interpreter(undefined, { tensorFusion,
        onTensorKernelExecuted: () => kernels++, onTensorKernelCompiled: () => compiled++ });
    try {
        const value = runtime.execute('use sequences\n' + source)!;
        return { value: formatValue(value), kernels, compiled };
    } catch (error) {
        return { error: (error as Error).message, kernels, compiled };
    } finally { runtime.dispose(); }
}

function compare(source: string) {
    const reference = run(source, false), fused = run(source, true);
    expect({ ...fused, kernels: 0, compiled: 0 }).toEqual({ ...reference, kernels: 0, compiled: 0 });
    return fused;
}

describe('concat in tensor expressions', () => {
    it('does not establish an unread input contract when a slice guard declines', () => {
        const loop = parse(`for K in 1 to 1
 Head = A take R
 Tail = A drop R
 Result = (A + concat Tail Head) mod M copy
end`).statements[0];
        if (!isForStatement(loop)) throw new Error('expected loop');
        const contract = new ArrayBindingContract('Input');
        const source = sliceSource(ownedArray([1n, 2n]))!.slice(2n, false);
        const values = new Map<string, RankValue>([['A', contract.check(source)], ['R', -1n], ['M', 10n]]);
        const kernel = compileTensorKernel(loop.statements, { lookup: name => values.get(name), builtin: () => true })!;
        expect(kernel.run()).toBeUndefined();
        expect(() => contract.check(ownedArray(['text']))).not.toThrow();
    });
    it('fuses private loop slices and declines if an outer name or inspection observes them', () => {
        const loop = parse(`for K in 1 to 1
 Head = A take R
 Tail = A drop R
 Result = (A + concat Tail Head) mod M copy
end`).statements[0];
        if (!isForStatement(loop)) throw new Error('expected loop');
        const values = new Map<string, RankValue>([
            ['A', ownedArray([1n, 2n, 3n])], ['R', 1n], ['M', 10n],
        ]);
        const kernel = compileTensorKernel(loop.statements, {
            lookup: name => values.get(name), builtin: () => true,
        })!;
        expect(kernel.count).toBe(3);
        expect(formatValue(kernel.run()!)).toBe('3 5 4');
        values.set('R', 2n ** 100n);
        expect(formatValue(kernel.run()!)).toBe('2 4 6');
        values.set('Head', ownedArray([9n]));
        expect(kernel.run()).toBeUndefined();
        values.delete('Head');
        const signal = new Int32Array(new SharedArrayBuffer(12));
        withInterrupt(signal, () => expect(kernel.run()).toBeUndefined(), () => {});
    });
    it('rebinds cached layouts to fresh buffers and changed scalar/array slots', () => {
        const values = new Map<string, RankValue>([
            ['A', ownedArray([1n, 2n])], ['B', ownedArray([3n])], ['M', 7n],
        ]);
        const kernel = compileTensorKernel(parse('X = ((concat A B) + M) copy').statements, {
            lookup: name => values.get(name), builtin: () => true,
        })!;
        expect(formatValue(kernel.run()!)).toBe('8 9 10');
        values.set('A', ownedArray([5n])); values.set('B', ownedArray([6n, 7n])); values.set('M', 5n);
        expect(formatValue(kernel.run()!)).toBe('10 11 12');
        values.set('A', ownedArray([2n, 3n])); values.set('B', ownedArray([4n])); values.set('M', 7n);
        expect(formatValue(kernel.run()!)).toBe('9 10 11');
        values.set('M', ownedArray([2n, 3n, 4n]));
        expect(formatValue(kernel.run()!)).toBe('4 6 8');
        values.set('M', ownedArray([7n], []));
        expect(formatValue(kernel.run()!)).toBe('9 10 11');
        values.set('M', 0.5);
        expect(formatValue(kernel.run()!)).toBe('2.5 3.5 4.5');
        values.set('A', ownedArray([2.0, 3.0]));
        expect(kernel.run()).toBeUndefined();
    });
    it.each([0, 1, 3, 4])('copies a rotation by %s with no transient concat array', rotation => {
        const result = compare(`A = array 9007199254740993 -2 3 -4
Head = A take ${4 - rotation}
Tail = A drop ${4 - rotation}
B = (A + concat Tail Head) mod 10000000000000000 copy
B`);
        expect(result.kernels).toBe(1);
    });

    it.each(['//', 'mod'])('preserves %s floor signs and zero-divisor fallback', operator => {
        expect(compare(`A = array -10 -9 0 9 10
B = array 3 -3 3 -3 3
C = (A ${operator} B) copy
C`).kernels).toBe(1);
        expect(compare(`A = array 3 0
C = (A ${operator} A) copy
C`)).toHaveProperty('error', 'division by zero');
    });

    it('preserves scalar errors before an empty result', () => {
        expect(compare('A = array shape 0 fill 0\nC = (A + (1 mod 0)) copy\nC'))
            .toHaveProperty('error', 'division by zero');
    });

    it('keeps segment homogeneity checks when numeric promotion would hide them', () => {
        expect(compare('A = array 1 2\nB = array 3.0 4.0\nC = ((concat A B) + 0.5) copy\nC'))
            .toHaveProperty('error');
    });

    it('broadcasts a concatenated column and handles a wholly empty result', () => {
        expect(compare(`A = array shape 2 1 fill 3
B = array shape 1 1 fill 5
Row = array 1 2
C = ((concat A B) + Row) copy
C`)).toMatchObject({ value: '4 5 4 5 6 7', kernels: 1 });
        expect(compare(`A = array shape 0 fill 0
C = ((concat A A) + 1) copy
C`)).toMatchObject({ kernels: 1 });
    });

    it('keeps the current offsets when equally shaped views change source positions', () => {
        const source = `A = array 1 2 3 4 5 6
Q = array shape 0 fill 0
for I in 0 till 3
 Head = (A drop I) take 2
 Tail = (A drop (I + 2)) take 2
 Q = ((concat Head Tail) * 2) copy
end
Q`;
        expect(compare(source)).toMatchObject({ value: '6 8 10 12', kernels: 3 });
    });

    it('reuses code while preserving the last intermediate bindings and old aliases', () => {
        const result = compare(`A = array 1 2 3 4
Old = A
Head = array shape 0 fill 0
Tail = array shape 0 fill 0
for I in 0 till 40
 R = I mod 5
 Head = A take R
 Tail = A drop R
 A = (A + concat Tail Head) mod 100 copy
end
(A sum) + (Old sum) + (Head sum) + (Tail sum)`);
        expect(result.kernels).toBe(40);
        expect(result.compiled).toBeLessThanOrEqual(5);
    });

    it('declines unsupported axes and retains CSP fallback', () => {
        compare('A = array shape 2 2 fill 1\nB = ((concat A A axis 1) + 1) copy\nB');
        const mock = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try {
            expect(compare('A = array 1 2\nB = ((concat A A) mod 3) copy\nB'))
                .toMatchObject({ value: '1 2 1 2', kernels: 0 });
        } finally { mock.mockRestore(); }
    });
});
