import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, createArraySnapshot, formatValue, parse, type RankArray, type RankValue } from '../src/index.js';
import { isFunctionStatement } from '@arrrank/language';
import { maskedArray } from '../src/array-storage.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';

const setup = `use sequences
use bits
fun Lows Highs Place Mask carry_sum
  Grid = Lows (Highs * Place) outer +
  Flat = Grid reshape #
  Selected = Flat (Flat Mask band equal 0)
  return Selected sum
end
Lows = array 0 1 2
Highs = array 0 1
Place = 5
Mask = 1
Lows Highs Place Mask carry_sum`;

function execute(source: string, tensorFusion: boolean) {
    const compiled: string[] = [];
    const runtime = new Interpreter(undefined, { tensorFusion, onTensorKernelCompiled: code => compiled.push(code) });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { value: formatValue(value!), shape: (value as RankArray)?.shape, kernels: diagnostics.compiledTensors,
            cells: diagnostics.cellsComputed, compiled };
    } catch (error) { return { error: String(error), kernels: diagnostics.compiledTensors, compiled }; }
    finally { runtime.dispose(); }
}

function compare(source: string) {
    const reference = execute(source, false), actual = execute(source, true);
    expect({ value: actual.value, shape: actual.shape, error: actual.error })
        .toEqual({ value: reference.value, shape: reference.shape, error: reference.error });
    return actual;
}

describe('retained digit product stages', () => {
    it('completes ordinary product, flattening and selected bindings', () => {
        const actual = compare(setup);
        expect(actual).toMatchObject({ value: '8', kernels: 0 });
        expect(actual.compiled).toEqual([]);
        expect(actual.cells).toBeGreaterThan(0);
    });

    it.each(['+', '-', '*'])('fuses inline outer %s and reshape without intermediate storage', operator => {
        const source = setup.replace(
            '  Grid = Lows (Highs * Place) outer +\n  Flat = Grid reshape #\n  Selected = Flat (Flat Mask band equal 0)\n  return Selected sum',
            `  return ((Lows (Highs * Place) outer ${operator}) reshape #) sum`);
        const actual = compare(source);
        expect(actual).toMatchObject({ value: operator === '+' ? '21' : operator === '-' ? '-9' : '15', kernels: 1, cells: 0 });
        expect(actual.compiled).toHaveLength(1);
        expect(actual.compiled[0].match(/for \(/g)).toHaveLength(1);
        expect(actual.compiled[0]).not.toContain('new Array');
    });

    it('fuses an inline mask count after the product has completed', () => {
        const source = setup.replace('  Selected = Flat (Flat Mask band equal 0)\n  return Selected sum',
            '  return (Flat Mask band equal 0) count');
        expect(compare(source)).toMatchObject({ value: '3', kernels: 1 });
    });

    it('stores survivors in row-major order', () => {
        expect(compare(setup.replace('Selected sum', 'Selected copy')))
            .toMatchObject({ value: '0 6 2', shape: [3], kernels: 0 });
    });

    it.each(['6', '2 3', '2 #', '# 3', '1 2 3'])('retains linear order through reshape %s', shape => {
        const source = setup.replace('Grid reshape #', `Grid reshape ${shape}\n  Vector = Flat reshape #`)
            .replace('Selected = Flat (Flat Mask', 'Selected = Vector (Vector Mask');
        expect(compare(source)).toMatchObject({ value: '8', kernels: 0 });
    });

    it.each(['+', '-', '*'])('preserves operand order for outer %s', operator => {
        expect(compare(setup.replace('outer +', `outer ${operator}`))).toMatchObject({ kernels: 0 });
    });

    it('preserves all operand axes', () => {
        const source = setup.replace('array 0 1 2', '(array 0 1 2 3) reshape 2 2')
            .replace('array 0 1\nPlace', '(array 0 1) reshape 1 2\nPlace');
        expect(compare(source)).toMatchObject({ kernels: 0 });
    });

    it('completes each of the nested digit products', () => {
        const source = setup.replace('  Grid = Lows (Highs * Place) outer +',
            '  Pair = Lows Highs outer +\n  Grid = Pair (Highs * Place) outer +');
        expect(compare(source)).toMatchObject({ kernels: 0 });
    });

    it('addresses a shared operand separately on each side of the product', () => {
        const source = setup.replace('  Grid = Lows (Highs * Place) outer +',
            '  Digits = Lows * Place\n  Grid = Digits Digits outer -');
        expect(compare(source)).toMatchObject({ value: '0', kernels: 0 });
    });

    it('broadcasts after a shape change', () => {
        const source = setup.replace('  Flat = Grid reshape #\n  Selected = Flat (Flat Mask band equal 0)\n  return Selected sum',
                '  Shaped = Grid reshape 3 2\n  Mapped = Shaped + Highs\n  return Mapped copy');
        expect(compare(source)).toMatchObject({ value: '0 6 1 7 2 8', shape: [3, 2], kernels: 0 });
    });

    it.each(['sum', 'copy'])('handles empty products and rejected values for %s', terminal => {
        for (const lows of ['array shape 0 fill 0', 'array 1 3 7']) {
            const source = setup.replace('array 0 1 2', lows).replace('Place = 5', 'Place = 2')
                .replace('Selected sum', `Selected ${terminal}`);
            expect(compare(source)).toMatchObject({ kernels: 0 });
        }
    });

    it('uses arbitrary-precision integers and signed bit masks', () => {
        const source = setup.replace('array 0 1 2', 'array -9007199254740993 9223372036854775807')
            .replace('Place = 5', 'Place = 9007199254740993').replace('Mask = 1', 'Mask = -8');
        expect(compare(source)).toMatchObject({ kernels: 0 });
    });

    it.each(['4', '4 #', '# 0', '-1', '2.0'])('retains reshape errors for %s', dimensions => {
        expect(compare(setup.replace('reshape #', `reshape ${dimensions}`))).toHaveProperty('error');
    });

    it('does not hide source errors behind a rejecting filter', () => {
        const source = setup.replace('Highs * Place', 'Highs // Place').replace('Place = 5', 'Place = 0')
            .replace('equal 0', 'equal -1');
        expect(compare(source)).toHaveProperty('error');
        expect(execute(source, true).kernels).toBe(0);
    });

    it('retains real and missing source diagnostics', () => {
        for (const lows of ['array 0.5 1.5 2.5', 'array 0 .NA 2']) {
            expect(compare(setup.replace('array 0 1 2', lows))).toHaveProperty('error');
        }
    });

    it('does not discard escaped products', () => {
        const source = setup.replace('  return Selected sum', '  Extra = Grid sum\n  return Selected sum + Extra');
        const actual = compare(source);
        expect(actual.value).toBeDefined();
        expect(actual.cells).toBeGreaterThan(0);
    });

    it('rebinds source storage, dimensions and empty shapes on repeated calls', () => {
        const source = setup.replace('Grid reshape #', 'Grid reshape (Mask + 5)\n  Vector = Flat reshape #')
            .replace('Selected = Flat (Flat Mask', 'Selected = Vector (Vector Mask');
        // First call accepts 6 cells; a changed Mask must recheck the reshape.
        expect(compare(source)).toMatchObject({ kernels: 0 });
        expect(compare(source + '\nMask = 0\nLows Highs Place Mask carry_sum')).toHaveProperty('error');
        expect(compare(setup + '\nLows 0 = 8\nLows Highs Place Mask carry_sum')).toMatchObject({ value: '16', kernels: 0 });
        expect(compare(setup + '\nLows = array 0 2\nHighs = array 0 1 2\nLows Highs Place Mask carry_sum'))
            .toMatchObject({ value: '24', kernels: 0 });
        expect(compare(setup + '\nLows = array shape 0 fill 0\nLows Highs Place Mask carry_sum'))
            .toMatchObject({ value: '0', kernels: 0 });
    });

    it('does not probe opaque host readers or move their reads behind the mask', () => {
        function run(tensorFusion: boolean) {
            let reads = 0;
            const runtime = new Interpreter(undefined, { tensorFusion });
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.execute(setup.slice(0, setup.lastIndexOf('\nLows Highs')));
                const source: RankArray = { kind: 'array', shape: [3], items: [], itemAt(index) { reads++; return BigInt(index); } };
                runtime.variables.set('Lows', source);
                const value = diagnostics.run(() => runtime.execute('Lows Highs Place Mask carry_sum'));
                return { value, reads };
            } finally { runtime.dispose(); }
        }
        expect(run(true)).toEqual(run(false));
        expect(run(true)).toMatchObject({ reads: 3 });
    });

    it('declines untracked storage without probing host shape or cell getters', () => {
        let reads = 0;
        const source: RankArray = { kind: 'array', get shape() { reads++; return [3]; },
            get items() { reads++; return [0n, 1n, 2n]; }, itemAt() { reads++; return 0n; } };
        const values = new Map<string, RankValue>([['Lows', source], ['Highs', createArraySnapshot([0n, 1n])],
            ['Place', 5n], ['Mask', 1n]]);
        const fn = parse('fun Lows Highs Place total\n return ((Lows (Highs * Place) outer +) reshape #) sum\nend').statements[0];
        if (!isFunctionStatement(fn)) throw Error('expected function');
        const kernel = compileTensorKernel(fn.statements[0], { lookup: name => values.get(name), builtin: () => true });
        expect(kernel).toBeDefined();
        expect(kernel!.run()).toBeUndefined();
        expect(reads).toBe(0);
    });

    it('retains missing typed-cell behavior under a rejecting filter', () => {
        function run(tensorFusion: boolean) {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                const source = setup.replace('equal 0', 'equal -1');
                runtime.execute(source.slice(0, source.lastIndexOf('\nLows Highs')));
                runtime.variables.set('Lows', maskedArray(new BigInt64Array([0n, 1n, 2n]), new Uint32Array([0b101])));
                return formatValue(runtime.execute('Lows Highs Place Mask carry_sum')!);
            } catch (error) { return String(error); }
            finally { runtime.dispose(); }
        }
        expect(run(true)).toBe(run(false));
    });

    it('rechecks the reshape builtin identity on subsequent calls', () => {
        function run(tensorFusion: boolean) {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                const first = runtime.execute(setup);
                runtime.execute('fun X replacement\n  return X\nend');
                runtime.variables.set('reshape', runtime.variables.get('replacement')!);
                try { return [first, runtime.execute('Lows Highs Place Mask carry_sum')]; }
                catch (error) { return [first, String(error)]; }
            } finally { runtime.dispose(); }
        }
        expect(run(true)).toEqual(run(false));
    });

    it('falls back when dynamic code generation is unavailable', () => {
        const expected = execute(setup, false).value;
        const mock = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try { expect(execute(setup, true).value).toBe(expected); }
        finally { mock.mockRestore(); }
    });
});
