import { compileScalarFunction } from '../src/scalar-function-kernel.js';
import { isFunctionStatement } from '@arrrank/language';
import { referenceCompilerOptions } from '../src/interpreter-options.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, parse, RankError, RuntimeDiagnostics, isRankArray, type RankValue } from '../src/index.js';
import { ArrayBindingScope, arrayForWrite, isSharedArray, noteArrayBinding, ownedArray } from '../src/array-storage.js';

it('releases only scoped aliases, retaining escaped owners', () => {
    const array = ownedArray([1n, 2n], [2]);
    const bindings = new ArrayBindingScope();
    bindings.bind('First', array);
    bindings.bind('Second', array);
    expect(isSharedArray(array)).toBe(true);
    bindings.release('Second');
    expect(arrayForWrite(array, 0)).toBeUndefined();
    noteArrayBinding(array);
    bindings.bind('First', array);
    expect(isSharedArray(array)).toBe(true);
    bindings.clear();
    bindings.bind('Third', array);
    expect(isSharedArray(array)).toBe(true);
});

for (const compiled of [false, true]) describe(`array binding lifetimes, compiled=${compiled}`, () => {
    function run(source: string) {
        const runtime = new Interpreter(undefined, compiled ? {} : referenceCompilerOptions({}));
        const diagnostics = new RuntimeDiagnostics();
        try {
            const value = diagnostics.run(() => runtime.execute(source));
            return { value: value && isRankArray(value) ? [...value.items] : value, copies: diagnostics.cowCopies };
        } finally { runtime.dispose(); }
    }

    it.each(['1 2 3', '"a" "b" "c"'])('retires a rebound alias of %s', cells => {
        expect(run(`fun solve
 A = array ${cells}
 B = A
 B = array ${cells}
 A 0 = A 1
 return A
end
solve`)).toEqual({ value: cells.startsWith('1') ? [2n, 2n, 3n] : ['b', 'b', 'c'], copies: 0 });
    });

    it('retains an alias while its binding is live', () => {
        expect(run(`fun solve
 A = array 1 2 3
 B = A
 A 0 = 9
 return (A 0) + B 0
end
solve`)).toEqual({ value: 10n, copies: compiled ? 0 : 1 });
    });

    it('releases a returned buffer before the caller writes it', () => {
        expect(run(`fun build
 A = array 1 2 3
 A 0 = 4
 return A
end
fun solve
 A = build
 A 1 = 8
 return A
end
solve`)).toEqual({ value: [4n, 8n, 3n], copies: 0 });
    });

    it('keeps original argument diagnostics after retiring a parameter binding', () => {
        const runtime = new Interpreter(undefined, compiled ? {} : referenceCompilerOptions({}));
        try {
            expect(() => runtime.execute(`fun Cells fail
 Saved = Cells
 Cells = array 4 5 6
 Saved 0 = 9
 return 1 // 0
end
(array 1 2 3) fail`)).toThrow();
            try { runtime.execute('(array 1 2 3) fail'); }
            catch (error) {
                expect(error).toBeInstanceOf(RankError);
                expect((error as RankError).formatCalls()).toContain('Cells = array[3]: 1 2 3');
            }
        } finally { runtime.dispose(); }
    });

    it('retains an array returned to the host', () => {
        const runtime = new Interpreter(undefined, compiled ? {} : referenceCompilerOptions({}));
        try {
            runtime.execute('fun A identity\n return A\nend\nA = array 1 2 3');
            const value = runtime.execute('A identity');
            runtime.execute('A 0 = 9');
            expect(value && isRankArray(value) && [...value.items]).toEqual([1n, 2n, 3n]);
        } finally { runtime.dispose(); }
    });

    it('retains an array saved by an opaque host callback after rebinding', () => {
        const runtime = new Interpreter(undefined, compiled ? {} : referenceCompilerOptions({}));
        let saved: RankValue | undefined;
        runtime.variables.set('retain', { kind: 'function', name: 'retain', arities: [1], monadicRank: 'all',
            call: args => { saved = args[0]; return 0n; } });
        try {
            runtime.execute(`fun solve
 A = array 1 2 3
 B = A
 B retain
 B = array 4 5 6
 A 0 = 9
 return A
end
solve`);
            expect(saved && isRankArray(saved) && [...saved.items]).toEqual([1n, 2n, 3n]);
        } finally { runtime.dispose(); }
    });
});

for (const direct of [false, true]) it(`retires array aliases in the exact compiled kernel, direct=${direct}`, () => {
    const statement = parse(`fun Size solve
 Cells = array shape Size fill 1
 Spare = Cells
 Spare = array shape 1 fill 0
 Cells 0 = 9
 return Cells 0
end`).statements[0];
    if (!isFunctionStatement(statement)) throw Error('expected function');
    const kernel = compileScalarFunction(statement, ['integer'], true);
    expect(kernel).toBeDefined();
    const diagnostics = new RuntimeDiagnostics();
    const value = diagnostics.run(() => direct
        ? (kernel!.direct!(error => error) as (size: bigint) => RankValue)(3n)
        : kernel!.run([3n], error => error));
    expect(value).toBe(9n);
    expect(diagnostics.cowCopies).toBe(0);
});

it('retains retired original arguments for exact-kernel diagnostics', () => {
    const statement = parse(`fun Cells fail
 Saved = Cells
 Cells = array shape 3 fill 4
 Saved 0 = 9
 return 1 // 0
end`).statements[0];
    if (!isFunctionStatement(statement)) throw Error('expected function');
    const kernel = compileScalarFunction(statement, [{ kind: 'array', element: 'integer', rank: 1 }], true);
    expect(kernel).toBeDefined();
    const cells = ownedArray([1n, 2n, 3n], [3]);
    expect(() => kernel!.run([cells], error => error)).toThrow();
    expect([...cells.items]).toEqual([1n, 2n, 3n]);
});
