import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { framedArray } from '../src/framed-array.js';
import { permutedArray } from '../src/array-permutation.js';
import { mapScalarArrays } from '../src/scalar-array-map.js';

const setup = `use io
use stats
use numbers
use sequences
fun X empty
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2) empty rank 0`;

describe.each([false, true])('producer geometry through composition (compilation=%s)', compilation => {
    it.each([
        ['Rows * 2', [2, 0], ['1', '2']],
        ['-Rows', [2, 0], ['1', '2']],
        ['Rows transpose', [0, 2], ['1', '2']],
        ['Rows transpose * 2', [0, 2], ['1', '2']],
        ['Rows + Rows', [2, 0], ['1', '1', '2', '2']],
        ['Rows log rank 2', [2, 0], ['1', '2']],
        ['(Rows * 2) 1', [0], ['2']],
        ['(-Rows) 1', [0], ['2']],
        ['Rows transpose # 1', [0], ['2']],
        ['(Rows transpose * 2) # 1', [0], ['2']],
        ['Rows transpose # (array 1 1 0)', [0, 3], ['2', '2', '1']],
        ['(Rows + Rows) take 0', [0, 0], []],
        ['Rows transpose # (array shape 0 fill 0)', [0, 0], []],
    ] as const)('preserves selected producers for %s', (expression, shape, pass) => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`${setup}\nPlan' = ${expression}`);
            expect(output).toEqual([]);
            runtime.execute('Saved = Plan');
            const saved = runtime.variables.get('Saved')!;
            if (!isRankArray(saved)) throw Error('expected completed array');
            expect(saved.shape).toEqual(shape);
            expect(output).toEqual(pass);
            runtime.execute('Again = Plan');
            expect(output).toEqual([...pass, ...pass]);
            runtime.execute('Saved sum');
            expect(output).toEqual([...pass, ...pass]);
        } finally { runtime.dispose(); }
    });

    it('permutes producer frames as well as scalar axes', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`${setup}
Cube' = ((1 to 6) reshape 2 3) empty rank 0
Turned' = Cube transpose axis 2 1 0`);
            expect(output).toEqual([]);
            runtime.execute('Saved = Turned');
            expect(runtime.variables.get('Saved')).toMatchObject({ shape: [0, 3, 2] });
            expect(output).toEqual(['1', '4', '2', '5', '3', '6']);
            output.length = 0;
            runtime.execute('Picked = Turned # (array 2 0) (array 1)');
            expect(runtime.variables.get('Picked')).toMatchObject({ shape: [0, 2, 1] });
            expect(output).toEqual(['6', '4']);
        } finally { runtime.dispose(); }
    });

    it.each(['Rows mean', '(Rows * 2) mean', 'Rows transpose mean'])('observes producers before the empty-data error in %s', expression => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(setup);
            expect(() => runtime.execute(`Saved = ${expression}`)).toThrow('mean requires at least one value');
            expect(output).toEqual(['1', '2']);
            expect(runtime.variables.has('Saved')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('keeps nonempty selected cells after permutation', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`use io
use sequences
fun X pair
 X print
 return array X (X + 10)
end
Rows' = (array 1 2 3) pair rank 0
Turned' = (Rows + 1) transpose
Saved = Turned # 1`);
            expect(output).toEqual(['2']);
            expect(runtime.variables.get('Saved')).toMatchObject({ shape: [2], items: [3n, 13n] });
        } finally { runtime.dispose(); }
    });
});

it('completes nested empty producers in frame order without retaining their results', () => {
    const calls: string[] = [];
    const outer = framedArray([2], index => {
        calls.push(`outer ${index}`);
        return framedArray([2], inner => {
            calls.push(`inner ${index} ${inner}`);
            return { kind: 'array', shape: [0], items: [] };
        }, { shape: [0], ownFiles() {}, mismatch: () => Error('inner shape changed') });
    }, { shape: [2, 0], ownFiles() {}, mismatch: () => Error('outer shape changed') });
    expect(outer.shape).toEqual([2, 2, 0]);
    expect(calls).toEqual([]);
    expect(outer.items).toEqual([]);
    const pass = ['outer 0', 'inner 0 0', 'inner 0 1', 'outer 1', 'inner 1 0', 'inner 1 1'];
    expect(calls).toEqual(pass);
    expect(outer.items).toEqual([]);
    expect(calls).toEqual([...pass, ...pass]);
});

it('does not retain successful producer prefixes after a composed read fails', () => {
    const calls: number[] = [];
    let fail = true;
    const source = framedArray([3], index => {
        calls.push(index);
        if (fail && index === 1) throw Error('producer failed');
        return { kind: 'array', shape: [0], items: [] };
    }, { shape: [0], ownFiles() {}, mismatch: () => Error('shape changed') });
    const mapped = mapScalarArrays([source], () => { throw Error('no scalar callback is needed'); });
    if (!isRankArray(mapped)) throw Error('expected mapped array');
    const view = permutedArray(mapped, [1, 0]);
    expect(() => view.items).toThrow('producer failed');
    expect(calls).toEqual([0, 1]);
    fail = false;
    expect(view.items).toEqual([]);
    expect(calls).toEqual([0, 1, 0, 1, 2]);
});
