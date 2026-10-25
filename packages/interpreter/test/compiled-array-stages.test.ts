import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, RuntimeDiagnostics } from '../src/index.js';
import { ownedArray, readArrayItem, writeArrayCell } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';

function run(source: string, compiled: boolean) {
    let calls = 0;
    const runtime = new Interpreter(undefined, { compilation: compiled, onScalarFunctionExecuted: () => calls++ });
    try {
        return { value: formatValue(runtime.execute(`use sequences\n${source}`)!), calls };
    } catch (error) {
        if (!(error instanceof RankError)) throw error;
        return { error: error.format(), calls };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), compiled = run(source, true);
    expect({ ...compiled, calls: 0 }).toEqual({ ...reference, calls: 0 });
    expect(compiled.calls).toBeGreaterThan(0);
    return compiled;
}

describe('compiled function array stages', () => {
    it('compiles the unchanged poker score and retains its exact score ordering', () => {
        const source = readFileSync(new URL('../../../demos/euler/054_poker.ra', import.meta.url), 'utf8');
        const functions = source.slice(source.indexOf('fun Hands'));
        const diagnostics = new RuntimeDiagnostics();
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(`use sequences\nuse text\nRanks = "23456789TJQKA"\n${functions}`);
            const value = diagnostics.run(() => runtime.execute('("2H 2D 4C 4D 4S" split " ") hand_score'));
            expect(formatValue(value!)).toBe('6 2 2 2 0 0');
            // One score body and five calls each to the rank and suit helpers.
            expect(calls).toBe(11);
            expect(diagnostics.compiledTensors).toBe(4);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['(array 1 2)', '(array 2 2 1)', '1 2'],
        ['(array shape 0 fill 0)', '(array 2 2 1)', ''],
        ['(array 1 2)', '(array shape 0 fill 0)', '0 0'],
        ['(array 9007199254740993 2)', '(array 9007199254740992.0 2.0)', '0 1'],
    ])('fuses outer comparisons with row counts for %s and %s', (left, right, expected) => {
        const result = compare(`fun A frequencies B
 Matches' = A B outer equal
 Counts = Matches count rank 1
 return Counts
end
${left} frequencies ${right}`);
        expect(result.value).toBe(expected);
    });

    it('keeps the shape when an ordinary binding completes an outer result', () => {
        compare(`fun A table B
 Matches = A B outer equal
 return Matches
end
(array 1 2) table (array 2 1 2)`);
    });

    it('reduces stored matrices with the same row geometry', () => {
        compare(`fun Matrix totals
 Result = Matrix sum rank 1
 return Result
end
(array shape 2 3 fill 7) totals`);
    });

    it.each(['sort', 'unique', 'argsort .descending'])('keeps native %s semantics, including exact integers and ties', operation => {
        compare(`fun A transform
 Result = A ${operation}
 return Result
end
(array 9007199254740993 2 9007199254740992 2) transform`);
    });

    it('maps text helpers, counts unique suits and sorts ranks in one compiled function', () => {
        compare(`Ranks = "23456789TJQKA"
fun Card value
 return Ranks find (Card 0)
end
fun Card suit
 return Card 1
end
fun Cards summarize
 Values = Cards value rank 0
 Suits' = Cards suit rank 0
 Sorted = Values sort
 Count = Suits unique len
 return (Sorted sum) + Count
end
(array "AH" "2H" "2S") summarize`);
    });

    it.each(['', ' ', 'a𝄞', 'abc'])('keeps text-array unique and len for %s', text => {
        compare(`fun A distinct_count
 Count = A unique len
 return Count
end
(array "${text}" "${text}" "𝄞") distinct_count`);
    });

    it('keeps stable order, gather, unpack and ignored targets', () => {
        const result = compare(`fun Values order
 Keys' = Values * 2
 Order = Keys argsort .descending
 Result = Values Order
 unpack A # C = Result
 return array A C
end
(array 2 1 2) order`);
        expect(result.value).toBe('2 1');
    });

    it.each(['(array -1 0)', '(array 0 3)'])('keeps gather errors for %s', selector => {
        compare(`fun Values gather Order
 Result = Values Order
 return Result
end
(array 1 2 3) gather ${selector}`);
    });

    it('keeps unpack length errors', () => {
        compare(`fun Values unpack_values
 unpack A B = Values
 return A + B
end
(array 1 2 3) unpack_values`);
    });

    it.each(['max', 'min'])('keeps empty %s errors', operation => {
        compare(`fun Values reduce_values
 Result = Values ${operation}
 return Result
end
(array shape 0 fill 0) reduce_values`);
    });

    it('does not execute an unused mapped plan', () => {
        const result = compare(`fun Text second
 return Text 1
end
fun Cards unused
 Deferred' = Cards second rank 0
 return 42
end
(array "x") unused`);
        expect(result.value).toBe('42');
        expect(result.calls).toBe(1);
    });

    it('keeps mapped errors at the ordinary completion boundary', () => {
        compare(`fun Text second
 return Text 1
end
fun Cards complete
 Values = Cards second rank 0
 return 42
end
(array "x") complete`);
    });

    it('recomputes deferred stages for independent consumers', () => {
        const result = compare(`fun N twice
 return N * 2
end
fun Values combine
 Mapped' = Values twice rank 0
 First = Mapped sum
 Second = Mapped sum
 return First + Second
end
(array 1 2 3) combine`);
        expect(result.value).toBe('24');
        expect(result.calls).toBe(7);
    });

    it('rechecks native sort bindings before entry', () => {
        for (const compiled of [false, true]) {
            const runtime = new Interpreter(undefined, { compilation: compiled });
            try {
                runtime.execute(`use sequences\nfun Values transform\nResult = Values sort\nreturn Result\nend`);
                expect(formatValue(runtime.execute('(array 2 1) transform')!)).toBe('1 2');
                runtime.variables.set('sort', native('replacement', 1, () => ({ kind: 'array', shape: [2], items: [9n, 8n] })));
                expect(formatValue(runtime.execute('(array 2 1) transform')!)).toBe('9 8');
            } finally { runtime.dispose(); }
        }
    });

    it('completes an ordinary stage before the next consumer observes a source write', () => {
        const input = ownedArray([1n, 2n, 3n]);
        let consumers = 0, calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++, onTensorKernelExecuted: () => {
            if (++consumers === 1) writeArrayCell(input, 0, 99n);
        } });
        runtime.variables.set('Input', input);
        try {
            expect(runtime.execute(`fun A transform
 Doubled = A * 2
 Shifted = Doubled + 1
 return Shifted sum
end
Input transform`)).toBe(15n);
            expect(readArrayItem(input, 0)).toBe(99n);
            expect(consumers).toBe(2);
            expect(calls).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('allows rebinding after an ordinary array completion', () => {
        compare(`fun Values transform
 Result = Values sort
 Values = array 9 8
 Left = Values sum
 Right = Result sum
 return Left + Right
end
(array 1 2) transform`);
    });

    it('rechecks the row reduction builtin before entry', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.execute(`use sequences
fun A frequencies B
 Matches' = A B outer equal
 Counts = Matches count rank 1
 return Counts
end`);
                expect(formatValue(runtime.execute('(array 1 2) frequencies (array 2 1)')!)).toBe('1 1');
                runtime.variables.set('count', native('replacement', 1, () => 7n));
                expect(formatValue(runtime.execute('(array 1 2) frequencies (array 2 1)')!)).toBe('7 7');
            } finally { runtime.dispose(); }
        }
    });

    it('guards transitive helper captures as their types change', () => {
        const errors = [false, true].map(compilation => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.execute(`use sequences
Captured = 3
fun N helper
 return Captured + N
end
fun Values combine
 Mapped = Values helper rank 0
 return Mapped sum
end`);
                expect(runtime.execute('(array 1 2) combine')).toBe(9n);
                runtime.variables.set('Captured', 7n);
                expect(runtime.execute('(array 1 2) combine')).toBe(17n);
                runtime.variables.set('Captured', 0.5);
                try { runtime.execute('(array 1 2) combine'); throw Error('expected return contract failure'); }
                catch (error) {
                    if (!(error instanceof RankError)) throw error;
                    return error.format();
                }
            } finally { runtime.dispose(); }
        });
        expect(errors[1]).toBe(errors[0]);
    });

    it('freezes helper captures at the deferred binding across repeated consumers', () => {
        let consumers = 0;
        const runtime = new Interpreter(undefined, { onTensorKernelExecuted: () => {
            if (++consumers === 1) runtime.variables.set('Captured', 7n);
        } });
        try {
            expect(runtime.execute(`use sequences
Captured = 3
fun N helper
 return Captured + N
end
fun Values combine
 Mapped' = Values helper rank 0
 First = Mapped sum
 Second = Mapped sum
 return First + Second
end
(array 1 2) combine`)).toBe(18n);
            expect(consumers).toBe(2);
        } finally { runtime.dispose(); }
    });
});
