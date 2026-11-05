import {describe, expect, it} from 'vitest';
import {Interpreter, formatValue, RankError} from '../src/index.js';
import {withDemandBudget, withInterrupt, DemandBudgetExhausted, InterruptedError} from '../src/interrupt.js';
import { typedArray } from '../src/array-storage.js';

const source = `use sequences
use bits
A = ((0 till 8) * 100000000000000003) copy
B = ((8 till 16) * 100000000000000007) copy
Ix = 0 till 8 array
Counts = (A (Ix bxor 1) + B (Ix band 3)) mod 1000000000000000000
Counts`;

function run(text: string, fusion: boolean) {
    let kernels = 0;
    const code: string[] = [];
    const runtime = new Interpreter(undefined, {
        scalarFunctionCompilation: false, integerLoopCompilation: false,
        tensorFusion: fusion, onTensorKernelExecuted: () => kernels++,
        onTensorKernelCompiled: text => code.push(text),
    });
    try { return {value: formatValue(runtime.execute(text)!), kernels, code}; }
    catch (error) { return {error: error instanceof RankError ? error.format() : String(error), kernels, code}; }
    finally { runtime.dispose(); }
}
function compare(text: string) {
    const expected = run(text, false), actual = run(text, true);
    expect({...actual, kernels: 0, code: []}).toEqual(expected);
    return actual;
}

describe('implicit bitwise tensor arithmetic', () => {
    it('fuses bitwise selectors, gathers and exact wide arithmetic in one pass', () => {
        const actual = compare(source);
        expect(actual.kernels).toBe(1);
        expect(actual.code[0]).toContain('^');
        expect(actual.code[0]).toContain('&');
        expect(actual.code[0].match(/for \(/g)).toHaveLength(1);
        const expected = Array.from({length: 8}, (_, i) =>
            (BigInt(i ^ 1) * 100000000000000003n
                + BigInt((i & 3) + 8) * 100000000000000007n) % 1000000000000000000n);
        expect(actual.value).toBe(expected.join(' '));
    });

    it.each(['band', 'bor', 'bxor'])('fuses %s arithmetic without an explicit copy', op => {
        const actual = compare(`use sequences\nuse bits\nA = array -9007199254740993 9007199254740993\nB = (A ${op} 9007199254740992) + 3\nB`);
        expect(actual.kernels).toBe(1);
    });

    it.each(['shl', 'shr'])('fuses %s with array counts and a reduction', op => {
        const values = [-9007199254740993n, 9007199254740993n, 1n << 100n];
        const counts = [0n, 37n, 101n];
        const actual = compare(`use bits
A = array ${values.join(' ')}
B = array ${counts.join(' ')}
Answer = A ${op} B sum
Answer`);
        expect(actual.kernels).toBe(1);
        expect(actual.value).toBe(String(values.reduce((sum, value, i) => sum
            + (op === 'shl' ? value << counts[i] : value >> counts[i]), 0n)));
        expect(actual.code[0].match(/for \(/g)).toHaveLength(1);
    });

    it('fuses packed decode and encode without Int32 truncation', () => {
        const actual = compare(`use bits
use sequences
Counts = 0 till 8 array
Value = 123456789012345678901234567890
Answer = (Value shr Counts band 63) shl (Counts * 6) sum
Answer`);
        expect(actual.kernels).toBe(1);
        expect(actual.value).toBe(String(Array.from({ length: 8 }, (_, i) =>
            ((123456789012345678901234567890n >> BigInt(i)) & 63n) << BigInt(i * 6))
            .reduce((a, b) => a + b, 0n)));
    });

    it.each(['shl', 'shr'])('retains %s errors and empty-count behavior', op => {
        for (const counts of ['array 0 -1 3', 'array 0.0 1.0', 'array 0 .NA']) {
            expect(compare(`use bits\nA = array 2 3 4\nB = ${counts}\nAnswer = A ${op} B sum\nAnswer`))
                .toHaveProperty('error');
        }
        expect(compare(`use bits\nuse sequences\nA = array shape 0 fill 1\nAnswer = A ${op} -1 sum\nAnswer`).value).toBe('0');
    });

    it.each(['shl', 'shr'])('keeps an aliased destination unchanged when %s fails late', op => {
        for (const tensorFusion of [false, true]) {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                runtime.execute('use bits\nA = array 2 3 4\nSaved = A\nCounts = array 1 2 -1');
                expect(() => runtime.execute(`A = (A ${op} Counts) + 1`)).toThrow(/shift count must be nonnegative/);
                expect(formatValue(runtime.execute('A')!)).toBe('2 3 4');
                expect(formatValue(runtime.execute('Saved')!)).toBe('2 3 4');
            } finally { runtime.dispose(); }
        }
    });

    it('keeps large single-shift sums on the native typed kernel', () => {
        let kernels = 0;
        const runtime = new Interpreter(undefined, { onTensorKernelExecuted: () => kernels++ });
        try {
            runtime.variables.set('A', typedArray(new Int32Array(2048).fill(3)));
            expect(runtime.execute('use bits\nA shl 6 sum')).toBe(393216n);
            expect(kernels).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('preserves counts beyond signed 64-bit storage', () => {
        expect(compare(source.replace('100000000000000003', '100000000000000000000000000000003')
            .replace('mod 1000000000000000000', 'mod 10000000000000000000000000000000000000000')).kernels).toBe(1);
    });

    it.each([
        ['Ix = 0 till 8 array', 'Ix = array 0 1 2 99'],
        ['Ix = 0 till 8 array', 'Ix = array 0 1 -1'],
        ['Ix = 0 till 8 array', 'Ix = array 0.0 1.0'],
        ['Ix = 0 till 8 array', 'Ix = array 0 .NA'],
        ['mod 1000000000000000000', 'mod 0'],
        ['mod 1000000000000000000', 'mod (1 // 0)'],
    ])('retains reference errors and locations for %s', (from, to) => {
        expect(compare(source.replace(from, to))).toHaveProperty('error');
    });

    it('retains empty selector behavior', () => {
        expect(compare(source.replace('Ix = 0 till 8 array', 'Ix = 0 till 0 array')).value).toBe('');
    });

    it('retains completed results across operand writes', () => {
        expect(compare(source + '\nSaved = Counts\nA 0 = 999\nCounts 0 = 7\narray Saved Counts')).toHaveProperty('value');
    });

    it('rechecks native identity after a successful compiled call', () => {
        function execute(fusion: boolean) {
            let kernels = 0;
            const runtime = new Interpreter(undefined, {tensorFusion: fusion,
                scalarFunctionCompilation: false, integerLoopCompilation: false,
                onTensorKernelExecuted: () => kernels++});
            try {
                runtime.execute(source.slice(0, source.indexOf('Counts =')) + `fun A B Ix calc\n  V = (A (Ix bxor 1) + B (Ix band 3)) mod 1000000000000000000\n  return V\nend\nA B Ix calc`);
                const first = kernels;
                runtime.execute('fun A replacement B\n  return A + B\nend');
                runtime.variables.set('bxor', runtime.variables.get('replacement')!);
                let error = '';
                try { runtime.execute('A B Ix calc'); }
                catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
                return {first, kernels, error};
            } finally { runtime.dispose(); }
        }
        const actual = execute(true), expected = execute(false);
        expect(actual.first).toBe(1);
        expect(actual.kernels).toBe(1);
        expect(actual.error).toBe(expected.error);
        expect(actual.error).not.toBe('');
    });
    it('honors budgets and cancellation over a cached tensor kernel', () => {
        const runtime = new Interpreter(undefined, {scalarFunctionCompilation: false});
        try {
            runtime.execute(source.slice(0, source.indexOf('Counts =')).replace('Ix = 0 till 8 array', 'Ix = ((0 till 4096) mod 8) copy') + `fun A B Ix calc
  V = (A (Ix bxor 1) + B (Ix band 3)) mod 1000000000000000000
  return V
end`);
            const expected = formatValue(runtime.execute('A B Ix calc')!);
            expect(formatValue(withDemandBudget(100000, () => runtime.execute('A B Ix calc'))!)).toBe(expected);
            expect(() => withDemandBudget(0, () => runtime.execute('A B Ix calc'))).toThrow(DemandBudgetExhausted);
            const signal = new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => runtime.execute('A B Ix calc'))).toThrow(InterruptedError);
            expect(formatValue(runtime.execute('A B Ix calc')!)).toBe(expected);
        } finally { runtime.dispose(); }
    });

});
