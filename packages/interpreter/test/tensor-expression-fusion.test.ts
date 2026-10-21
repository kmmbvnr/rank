import { describe, expect, it, vi } from 'vitest';
import { Interpreter, formatValue, type RankArray } from '../src/index.js';
import { typedArray, typedElementKind } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { demandValue } from '../src/plan.js';

function evaluate(source: string, tensorFusion: boolean) {
    const runtime = new Interpreter(undefined, { tensorFusion });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const result = diagnostics.run(() => runtime.execute(source));
        return { value: formatValue(result!), kernels: diagnostics.compiledTensors };
    } finally { runtime.dispose(); }
}

describe('implicit arithmetic tensor fusion', () => {
    it.each([
        ['array 1 2 3', 'array 4 5 6'],
        ['array 1.5 2.5 3.5', 'array 4.5 5.5 6.5'],
        ['array 9007199254740993 9223372036854775807', 'array 3 4'],
        ['(array 1 2 3 4 5 6) reshape 2 3', 'array 4 5 6'],
        ['(array 1 2) reshape 2 1', '(array 4 5 6) reshape 1 3'],
        ['array shape 0 fill 0', 'array shape 0 fill 0'],
    ])('fuses arithmetic over %s and %s', (a, b) => {
        const source = `use sequences\nA = ${a}\nB = ${b}\nR = (A + 7) * 11 - B\nR`;
        const reference = evaluate(source, false);
        const actual = evaluate(source, true);
        expect(actual.value).toBe(reference.value);
        expect(actual.kernels).toBe(1);
    });

    it('does not require or call the copy builtin', () => {
        const source = 'A = array 1 2 3\nR = A * A + 2 * A + 1\nR';
        expect(evaluate(source, true)).toEqual({ value: '4 9 16', kernels: 1 });
    });

    it.each(['(-A + 2) * 3', '(+A + 2) * 3', '(A + 2) * (A - 1)'])(
        'preserves unary signs and expression order for %s', expression => {
            const source = `A = array -3 0 7\nR = ${expression}\nR`;
            expect(evaluate(source, true).value).toBe(evaluate(source, false).value);
        });

    it('keeps scalar division errors outside an empty array computation', () => {
        const source = 'A = array shape 0 fill 0\nR = (A + 1) * (1 // 0)\nR';
        for (const fused of [false, true]) expect(() => evaluate(source, fused)).toThrow(/zero/);
    });

    it.each(['A / 2 + 3', 'A // 3 + 2', '(A mod 3) * 2', 'A ** 2 + 1'])(
        'uses guarded arithmetic kernels for %s', expression => {
            const source = `A = array -7 0 11\nR = ${expression}\nR`;
            expect(evaluate(source, true)).toEqual({ value: evaluate(source, false).value, kernels: 1 });
        });

    it('falls back without publishing results when division guards fail', () => {
        const source = 'A = array 3 0 7\nR = 9\nR = 12 // A + 1\nR';
        const outcome = (tensorFusion: boolean) => {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                try { return { value: formatValue(runtime.execute(source)!) }; }
                catch (error) { return { error: String(error), result: runtime.variables.get('R') }; }
            } finally { runtime.dispose(); }
        };
        expect(outcome(true)).toEqual(outcome(false));
    });

    it.each([new BigInt64Array([1n, 2n, 3n]), new Float64Array([1, 2, 3])])(
        'keeps stored typed inputs packed and results independent', buffer => {
            const runtime = new Interpreter();
            const input = typedArray(buffer);
            runtime.variables.set('A', input);
            const diagnostics = new RuntimeDiagnostics();
            try {
                expect(formatValue(diagnostics.run(() => runtime.execute('B = (A + 2) * 3 - A\nB'))!))
                    .toBe('8 10 12');
                expect(diagnostics.compiledTensors).toBe(1);
                expect(diagnostics.typedUnpacks).toBe(0);
                expect(typedElementKind(input)).toBe(buffer instanceof BigInt64Array ? 'integer' : 'real');
                runtime.execute(`B 0 = ${buffer instanceof BigInt64Array ? '99' : '99.0'}`);
                expect(formatValue(runtime.execute('A')!)).toBe('1 2 3');
            } finally { runtime.dispose(); }
        });

    it('refreshes bindings and shapes on repeated execution', () => {
        const source = `use sequences
fun A B calculate
  R = (A + B) * 3 - B
  return R
end
X = (array 1 2) (array 3 4) calculate
Y = (array 5 6 7) (array 1 2 3) calculate
X = X + 0
concat X Y`;
        expect(evaluate(source, true).value).toBe(evaluate(source, false).value);
    });

    it('retains reference errors and existing bindings', () => {
        for (const source of [
            'A = array 1 2\nB = array 1 2 3\nR = (A + 2) * B\nR',
            'A = array 1 .NA 3\nR = (A + 2) * 3\nR',
            'A = array 1 2\nR = 9\nR = (A + 2) * 3\nR',
        ]) {
            const outcome = (fused: boolean) => {
                try { return evaluate(source, fused).value; } catch (error) { return String(error); }
            };
            expect(outcome(true)).toBe(outcome(false));
        }
    });

    it('does not probe opaque readers while attempting fusion', () => {
        const runtime = new Interpreter();
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [3], items: [],
            itemAt: () => { reads++; return 1n; } };
        runtime.variables.set('A', host);
        const diagnostics = new RuntimeDiagnostics();
        try {
            const result = diagnostics.run(() => {
                runtime.execute("R' = (A + 1) * 2");
                return demandValue(runtime.variables.get('R')!);
            });
            expect(diagnostics.compiledTensors).toBe(0);
            expect(reads).toBe(0);
            expect(formatValue(result!)).toBe('4 4 4');
            expect(reads).toBe(3);
        } finally { runtime.dispose(); }
    });

    it('falls back when code generation is unavailable', () => {
        const source = 'A = array 1 2 3\nR = (A + 2) * 3\nR';
        const expected = evaluate(source, false).value;
        const mock = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try { expect(evaluate(source, true).value).toBe(expected); }
        finally { mock.mockRestore(); }
    });
});
