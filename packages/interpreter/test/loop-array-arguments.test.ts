import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, parse } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { compiledArgumentType, compiledStoredArgumentType } from '../src/compiled-argument-type.js';
import { semanticArrayType, setSemanticArrayType } from '../src/semantic-array-type.js';
import { native } from '../src/modules/shared.js';
import { MISSING, type RankArray } from '../src/value.js';

function unresolved(array: RankArray): RankArray {
    return setSemanticArrayType(array, { key: 'unresolved' });
}
const source = `fun A cell I
 return A I
end
Total = 0
for I in 0 till 3
 Total += A cell I
end
Total`;

function run(compilation: boolean, array: RankArray, text = source) {
    let loops = 0;
    const output: string[] = [];
    const runtime = new Interpreter(text => output.push(text), { compilation, scalarEntryCompilation: false,
        onIntegerLoopExecuted: () => loops++ });
    runtime.variables.set('A', array);
    try {
        const value = runtime.execute(text);
        return { value, loops, output, total: runtime.variables.get('Total') };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error),
            loops, output, total: runtime.variables.get('Total') };
    } finally { runtime.dispose(); }
}
function compare(make: () => RankArray, text = source) {
    const prior = run(false, make(), text), compiled = run(true, make(), text);
    expect({ ...compiled, loops: 0 }).toEqual({ ...prior, loops: 0 });
    return compiled;
}

describe('stored array arguments in compiled loop calls', () => {
    it.each(['boxed', 'int32', 'int64'])('links unresolved %s arrays without declaring their type', kind => {
        const make = () => unresolved(kind === 'boxed' ? ownedArray([1n << 65n, 2n, 3n])
            : typedArray(kind === 'int32' ? new Int32Array([1, 2, 3]) : new BigInt64Array([1n, 2n, 3n])));
        const array = make();
        expect(compiledArgumentType(array)).toBeUndefined();
        expect(compiledStoredArgumentType(array)).toEqual({ kind: 'array', element: 'integer', rank: 1 });
        expect(semanticArrayType(array).key).toBe('unresolved');
        const result = compare(make);
        expect(result).toHaveProperty('value', kind === 'boxed' ? (1n << 65n) + 5n : 6n);
        expect(result.loops).toBe(1);
        expect(run(true, array)).toHaveProperty('value', result.value);
        expect(semanticArrayType(array).key).toBe('unresolved');
    });

    it('links the ordinary completed scan used by Euler 354', () => {
        const result = compare(() => ownedArray([]), `use sequences
fun A cell I
 return A I
end
A = array shape 10000 fill 1
A = A scan +
Total = 0
for I in 0 till 3
 Total += A cell I
end
Total`);
        expect(result).toHaveProperty('value', 6n);
        expect(result.loops).toBe(1);
    });

    it.each(['A 0 = 9', 'B 0 = 9'])('retains caller writes and snapshot aliases through %s', write => {
        const result = compare(() => unresolved(typedArray(new Int32Array([1, 2, 3]))), `fun A cell I
 return A I
end
B = A
Total = 0
for I in 0 till 3
 ${write}
 Total += A cell I
end
Total`);
        expect(result).toHaveProperty('value', 14n);
        expect(result.loops).toBeGreaterThan(0);
    });

    it.each([
        ['short', () => unresolved(ownedArray([1n, 2n]))],
    ] as const)('preserves partial results and error locations for %s cells', (_name, make) => {
        expect(compare(make)).toHaveProperty('error');
    });

    it('declines missing and mixed stored domains without changing their contracts', () => {
        const mixed = ownedArray([1n, 2n, 3n]);
        mixed.items[1] = 2.5;
        for (const array of [ownedArray([1n, MISSING, 3n]), mixed]) {
            unresolved(array);
            expect(compiledStoredArgumentType(array)).toBeUndefined();
            expect(semanticArrayType(array).key).toBe('unresolved');
        }
        const result = compare(() => unresolved(ownedArray([1n, MISSING, 3n])),
            source.replace('return A I', 'return (A I) default 0'));
        expect(result).toHaveProperty('value', 4n);
    });

    it('keeps failed scalar-call recognition on the ordinary path', () => {
        const result = compare(() => unresolved(typedArray(new Int32Array([1, 2, 3]))), `use io
fun I noisy A
 I print
 return A I
end
Total = 0
for I in 0 till 3
 T = I
 Total += T noisy A
end
Total`);
        expect(result).toHaveProperty('value', 6n);
        expect(result.loops).toBe(0);
        expect(result.output).toEqual(['0', '1', '2']);
    });

    it('does not inspect lazy or host cells during admission', () => {
        let reads = 0;
        for (const array of [
            { kind: 'array', shape: [3], get items() { reads++; return [1n, 2n, 3n]; } },
            { kind: 'array', shape: [3], items: [], itemAt: () => { reads++; return 1n; } },
        ] as RankArray[]) expect(compiledStoredArgumentType(array)).toBeUndefined();
        expect(reads).toBe(0);
        const host = () => ({ kind: 'array' as const, shape: [3], items: [], itemAt: (i: number) => BigInt(i + 1) });
        expect(compare(host)).toHaveProperty('value', 6n);
    });

    it('rechecks a cached region after host writes change the cell domain', () => {
        const program = parse(source);
        const definition = program.statements.shift()!;
        const results = [false, true].map(compilation => {
            const runtime = new Interpreter(undefined, { compilation, scalarEntryCompilation: false });
            const array = unresolved(ownedArray([1n, 2n, 3n]));
            runtime.variables.set('A', array);
            runtime.executeProgram({ ...program, statements: [definition] });
            try {
                expect(runtime.executeProgram(program)).toBe(6n);
                array.items.fill(1.5);
                try { return { value: runtime.executeProgram(program) }; }
                catch (error) { return { error: error instanceof RankError ? error.format() : String(error) }; }
            } finally { runtime.dispose(); }
        });
        expect(results[1]).toEqual(results[0]);
        expect(results[1]).toMatchObject({ error: expect.stringContaining('cannot receive real') });
    });

    it('guards native identities when reusing a linked array helper', () => {
        const program = parse(`use numbers
fun A cell I
 return (A I) isqrt
end
Total = 0
for I in 0 till 3
 Total += A cell I
end
Total`);
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(undefined, { compilation, scalarEntryCompilation: false });
            runtime.variables.set('A', unresolved(typedArray(new Int32Array([1, 4, 9]))));
            try {
                expect(runtime.executeProgram(program)).toBe(6n);
                runtime.variables.set('isqrt', native('replacement', 1, () => 17n));
                expect(runtime.executeProgram(program)).toBe(51n);
            } finally { runtime.dispose(); }
        }
    });
});
