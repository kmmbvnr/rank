import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse, type NativeFunction, type RankValue } from '../src/index.js';
import { isFunctionStatement } from '@arrrank/language';
import { compileNumericFunction } from '../src/jit/numeric-function.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const source = `use numbers
use sequences
fun Weights stats Count
 Root = Count isqrt
 K = 1 to Root copy
 Q = Count // K
 Flag = K mod 2 equal 1
 Mask = Flag choose 1 0
 Values = Weights K
 A = Mask * Q sum
 B = Values * Mask sum
 return tuple A B
end`;
function fixture(text = source, compilation = true) {
    const programs: string[] = [], diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, compilation,
        onFunctionBodyCompiled: text => { if (text.includes('integer reductions')) programs.push(text); } });
    runtime.execute(text);
    const fn = runtime.variables.get('stats') as NativeFunction;
    return { runtime, programs, diagnostics, call: (args: RankValue[]) => diagnostics.run(() => fn.call(args)) };
}
function outcome(run: () => RankValue | undefined): unknown {
    try {
        const value = run();
        if (typeof value === 'object' && value.kind === 'tuple') return value.items;
        if (typeof value === 'object' && value.kind === 'array') return { shape: value.shape, items: [...value.items] };
        return value;
    } catch (error) { return { error: (error as Error).message }; }
}
const weights = (n = 100) => typedArray(Int32Array.from({ length: n }, (_, i) => i % 5 - 2));

describe('exact integer reductions in array functions', () => {
    it('shares reductions and generated code across changing sizes and data', () => {
        const fast = fixture(), reference = fixture(source, false);
        try {
            for (let n = 4; n < 400; n += 7) {
                const args = [weights(), BigInt(n)];
                expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            }
            expect(fast.diagnostics.compiledArrayFunctions).toBeGreaterThan(40);
            expect(fast.programs).toHaveLength(1);
            expect(fast.programs[0].match(/for \(let i/g)).toHaveLength(1);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it.each(['return array A B', 'return A + B'])('publishes exact output kinds: %s', returned => {
        const text = source.replace('return tuple A B', returned), fast = fixture(text), reference = fixture(text, false);
        try {
            const args = [weights(), 999n];
            expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it.each([-3n, 2n, 3n, 7n])('keeps exact division and canonical mod after a reduction: %s', divisor => {
        const text = `use sequences
fun Values stats Scale Divisor
 Total = Values * Scale sum
 Q = Total // Divisor
 R = Total mod Divisor
 return tuple Q R
end`;
        const fast = fixture(text), reference = fixture(text, false);
        try {
            const args = [typedArray(new Int32Array([1])), 9007199254740991n, divisor];
            expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it.each(['equal', 'not equal', 'less', 'greater', 'at most', 'at least'])(
        'keeps exact comparison masks: %s', comparison => {
            const text = `use sequences
fun Weights stats Count
 K = 1 to Count copy
 Values = Weights K
 Flag = Values ${comparison} 0
 Negative = 0 - Values
 Chosen = Flag choose Values Negative
 return Chosen sum
end`;
            const fast = fixture(text), reference = fixture(text, false);
            try {
                const args = [weights(), 30n];
                expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
                expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
            } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
        });

    it.each([4, 20])('keeps boolean gather semantics for source length %s', length => {
        const text = `use sequences
fun Weights stats Count
 K = 0 till Count copy
 Flags = K mod 2 equal 1
 Selected = Weights Flags
 return Selected sum
end`;
        const fast = fixture(text), reference = fixture(text, false);
        try {
            const args = [typedArray(new Int32Array(length).fill(1)), 20n];
            expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(0);
            if (length === 20) expect(fast.call(args)).toBe(10n);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it('fuses multidimensional broadcast reductions', () => {
        const text = `use sequences
fun Matrix stats Weights
 Grid = Matrix reshape 2 #
 A = Grid * Weights sum
 B = Grid // 3 sum
 return tuple A B
end`;
        const fast = fixture(text), reference = fixture(text, false);
        try {
            const args = [typedArray(new Int32Array([-7,2,3,4,-5,6])), typedArray(new Int32Array([2,-3,4]))];
            expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
            expect(fast.programs[0].match(/for \(let i/g)).toHaveLength(1);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it('uses distinct frames for independent reductions of different sizes', () => {
        const text = `use sequences
fun Weights stats Count
 K = 1 to Count copy
 J = 1 to Count + 1 copy
 A = Weights K sum
 B = Weights J sum
 return tuple A B
end`;
        const fast = fixture(text), reference = fixture(text, false);
        try {
            for (const n of [5n,8n,20n]) {
                const args = [weights(), n];
                expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            }
            expect(fast.diagnostics.compiledArrayFunctions).toBe(3);
            expect(fast.programs).toHaveLength(1);
            expect(fast.programs[0].match(/for \(let i/g)).toHaveLength(2);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it('declines a dependent reduction and rechecks a replaced builtin after warming', () => {
        const dependent = `use sequences
fun Weights stats Count
 K = 1 to Count copy
 Values = Weights K
 Total = Values sum
 Shifted = Values + Total
 return Shifted sum
end`;
        const fast = fixture(dependent), reference = fixture(dependent, false);
        try {
            expect(outcome(() => fast.call([weights(),10n]))).toEqual(outcome(() => reference.call([weights(),10n])));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(0);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
        const statement = parse(source).statements.find(isFunctionStatement);
        if (!statement) throw Error('fixture');
        const variables = new Map<string, RankValue>([['Weights', weights()], ['Count', 100n]]);
        let available = true, executions = 0;
        const plan = compileNumericFunction(statement, { lookup: name => variables.get(name),
            builtin: name => name !== 'sum' || available, compiled() {}, executed() { executions++; } })!;
        expect(plan.run()).toBeDefined();
        available = false;
        expect(plan.run()).toBeUndefined();
        expect(executions).toBe(1);
        available = true;
        expect(plan.run()).toBeDefined();
        expect(executions).toBe(2);
    });

    it('keeps affine range sums closed-form and separates them from traversed frames', () => {
        const text = `use sequences
fun Weights stats Count
 Keys = 1 to Count copy
 Line = 3 * Keys - 7
 Closed = Line sum
 Other = 1 to Count + 1 copy
 Values = Weights Other
 Read = Values sum
 return tuple Closed Read
end`;
        const fast = fixture(text), reference = fixture(text, false);
        try {
            for (const n of [3n,10n,40n]) {
                const args = [weights(), n];
                expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            }
            expect(fast.diagnostics.compiledArrayFunctions).toBe(3);
            expect(fast.programs).toHaveLength(1);
            expect(fast.programs[0].match(/for \(let i/g)).toHaveLength(1);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
        const pure = `use sequences
fun Count stats
 Keys = 1 to Count copy
 Values = 3 * Keys - 7
 return Values sum
end`;
        const range = fixture(pure), exact = fixture(pure, false);
        try {
            expect(outcome(() => range.call([10000n]))).toEqual(outcome(() => exact.call([10000n])));
            expect(range.diagnostics.compiledArrayFunctions).toBe(1);
            expect(range.programs[0]).not.toContain('for (let i');
        } finally { range.runtime.dispose(); exact.runtime.dispose(); }
    });

    it('revalidates mutated input storage and declines unsafe prefix bounds', () => {
        const text = `use sequences
fun Values stats Scale
 K = 0 till (Values len)
 Products = Values K * Scale
 return Products sum
end`;
        const fast = fixture(text), reference = fixture(text, false), values = typedArray(new Int32Array([1,1,1]));
        try {
            const args = [values, 3000000000000000n];
            expect(outcome(() => fast.call(args))).toEqual(9000000000000000n);
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
            values.items[0] = 2n;
            expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
            const wide = [typedArray(new BigInt64Array([1n << 60n, 3n])), 1n];
            expect(outcome(() => fast.call(wide))).toEqual(outcome(() => reference.call(wide)));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it('retains range/gather errors, dead bindings and deferred names', () => {
        for (const text of [source, source.replace(' Root =', ' Unused = 1 // 0\n Root ='),
            source.replace(' Root =', " Unused' = 1 // 0\n Root =")]) {
            const fast = fixture(text), reference = fixture(text, false);
            try {
                for (const args of [[weights(), -1n], [weights(2), 100n], [weights(), 0n], [weights(), 100n]])
                    expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
            } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
        }
    });

    it('does not bypass a host reader installed after warmup', () => {
        const fast = fixture(), reference = fixture(source, false), input = weights();
        try {
            fast.call([input, 100n]);
            let reads = 0;
            Object.defineProperty(input, 'itemAt', { value: () => { reads++; return 7n; }, configurable: true });
            expect(outcome(() => fast.call([input, 100n]))).toEqual(outcome(() => reference.call([input, 100n])));
            expect(reads).toBeGreaterThan(0);
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it('retains budget, inspection and cancellation after a warm ordinary call', () => {
        const fast = fixture(), reference = fixture(source, false), args = [weights(), 999n];
        try {
            fast.call(args);
            expect(outcome(() => withDemandBudget(10, () => fast.call(args))))
                .toEqual(outcome(() => withDemandBudget(10, () => reference.call(args))));
            expect(outcome(() => withInterrupt(new Int32Array(3), () => fast.call(args), () => {})))
                .toEqual(outcome(() => withInterrupt(new Int32Array(3), () => reference.call(args), () => {})));
            const flag = new Int32Array(new SharedArrayBuffer(4)); flag[0] = 1;
            expect(outcome(() => withInterrupt(flag, () => fast.call(args)))).toHaveProperty('error');
            expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
            expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it('declines shared integer buffers and works without SharedArrayBuffer', () => {
        const fast = fixture(), reference = fixture(source, false);
        try {
            const input = typedArray(new Int32Array(new SharedArrayBuffer(400)));
            expect(outcome(() => fast.call([input, 100n]))).toEqual(outcome(() => reference.call([input, 100n])));
            expect(fast.diagnostics.compiledArrayFunctions).toBe(0);
            const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'SharedArrayBuffer')!;
            try {
                Object.defineProperty(globalThis, 'SharedArrayBuffer', { ...descriptor, value: undefined });
                const args = [weights(), 100n];
                expect(outcome(() => fast.call(args))).toEqual(outcome(() => reference.call(args)));
                expect(fast.diagnostics.compiledArrayFunctions).toBe(1);
            } finally { Object.defineProperty(globalThis, 'SharedArrayBuffer', descriptor); }
        } finally { fast.runtime.dispose(); reference.runtime.dispose(); }
    });

    it('revalidates compilation observers before using integer interval proofs', () => {
        const statement = parse(source).statements.find(isFunctionStatement);
        if (!statement) throw Error('fixture');
        const variables = new Map<string, RankValue>([['Weights', weights()], ['Count', 100n]]);
        let executions = 0;
        const plan = compileNumericFunction(statement, { lookup: name => variables.get(name), builtin: () => true,
            compiled() { variables.set('Weights', weights(2)); }, executed() { executions++; } })!;
        expect(plan.run()).toBeUndefined();
        expect(executions).toBe(0);
        variables.set('Weights', weights());
        expect(plan.run()).toBeDefined();
        expect(executions).toBe(1);
    });

    it('keeps ordinary budget charges in a warmed real function call loop', () => {
        const definitions = `use sequences
fun Values doubled
 Flat = Values reshape #
 return Flat * 2.0
end
A = array shape 64 fill 1.0
I = 0`;
        const fast = new Interpreter(undefined, { scalarEntryCompilation: false }), reference = new Interpreter(() => {}, { scalarEntryCompilation: false, compilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            fast.execute(definitions); reference.execute(definitions);
            diagnostics.run(() => fast.execute('A doubled'));
            const loop = 'for I less 3\n A = A doubled\n I += 1\nend';
            const actual = outcome(() => withDemandBudget(1, () => diagnostics.run(() => fast.execute(loop))));
            const expected = outcome(() => withDemandBudget(1, () => reference.execute(loop)));
            expect(actual).toEqual(expected);
            expect(actual).toHaveProperty('error');
            expect(fast.execute('I')).toBe(reference.execute('I'));
            expect(outcome(() => fast.execute('A'))).toEqual(outcome(() => reference.execute('A')));
            expect(diagnostics.compiledArrayFunctions).toBe(1);
            expect(diagnostics.compiledNumericCallLoops).toBe(0);
        } finally { fast.dispose(); reference.dispose(); }
    });

    it('keeps integer arrays out of the real-only composed call loop', () => {
        const text = `use sequences
fun Values twice
 K = 0 till (Values len)
 return Values K * 2
end
A = array 1 2 3
I = 0
for I less 2
 A = A twice
 I += 1
end`;
        const fast = new Interpreter(undefined, { scalarEntryCompilation: false }), reference = new Interpreter(() => {}, { scalarEntryCompilation: false, compilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => fast.execute(text)); reference.execute(text);
            expect(outcome(() => fast.execute('A'))).toEqual(outcome(() => reference.execute('A')));
            expect(fast.execute('A sum')).toBe(24n);
            expect(diagnostics.compiledNumericCallLoops).toBe(0);
        } finally { fast.dispose(); reference.dispose(); }
    });
});
