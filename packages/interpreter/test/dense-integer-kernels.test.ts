import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankValue } from '../src/index.js';
import { ownedArray, readArrayItem, typedArray } from '../src/array-storage.js';
import { numericKernel } from '../src/numeric-kernels.js';
import { mapDenseArrays } from '../src/tensor.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

const operations = [
    { name: '+', code: 0, apply: (a: bigint, b: bigint) => a+b },
    { name: '-', code: 1, apply: (a: bigint, b: bigint) => a-b },
    { name: '*', code: 2, apply: (a: bigint, b: bigint) => a*b },
];
describe('proved dense integer kernels', () => {
    for (const { name, code, apply } of operations) it(`keeps ${name} exact across Int64 and Number bounds`, () => {
        const values = [-(1n << 100n), -9223372036854775808n, 0n, 9223372036854775807n, 1n << 100n];
        const source = ownedArray(values);
        const op = numericKernel(name, () => { throw new Error('fallback'); });
        for (const [a,b] of [[source, 3n], [3n, source], [source, source]] as [RankValue, RankValue][]) {
            const result = mapDenseArrays(a,b,op,code,true)!;
            expect(values.map((x,i) => readArrayItem(result,i))).toEqual(values.map(x => apply(typeof a === 'bigint' ? a : x, typeof b === 'bigint' ? b : x)));
        }
        const typed = typedArray(new BigInt64Array([9223372036854775807n]));
        const result = mapDenseArrays(typed, 3n, op, code, true)!;
        expect(readArrayItem(result,0)).toBe(apply(9223372036854775807n,3n));
    });

    it('retains trailing/general broadcasts, mixed reals and missing fallback', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nA = (1 to 6 array) reshape 2 3');
            expect(formatValue(runtime.execute('A + (array 10 20 30)')!)).toBe('11 22 33 14 25 36');
            expect(formatValue(runtime.execute('A * ((array 2 3) reshape 2 1)')!)).toBe('2 4 6 12 15 18');
            expect(formatValue(runtime.execute('(array 1 2) + 0.5')!)).toBe('1.5 2.5');
            expect(formatValue(runtime.execute('(array 1 .NA) + 2')!)).toBe('3 .NA');
        } finally { runtime.dispose(); }
    });

    it('checks cancellation on an integer-only dense pass', () => {
        const source = ownedArray(Array(8192).fill(2n));
        const signal = new Int32Array(new SharedArrayBuffer(4)); signal[0] = 1;
        expect(() => withInterrupt(signal, () => mapDenseArrays(source,3n,numericKernel('*',()=>0n),2)))
            .toThrow(InterruptedError);
    });
});
