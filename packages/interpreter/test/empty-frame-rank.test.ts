import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { run } from './support.js';
import { native } from '../src/modules/shared.js';

const shape = (source: string) => run(`use sequences\n${source}\nR shape`);

describe('Rank over an empty frame', () => {
    it('keeps the result cell axes of shape-preserving builtins', () => {
        expect(shape('M = array shape 0 3 fill 1\nR = M sort rank 1')).toBe('0 3');
        expect(shape('M = array shape 0 3 fill 1\nR = M argsort')).toBe('0 3');
        expect(shape('M = array shape 0 3 fill 1\nR = M sum rank 1')).toBe('0');
    });

    it('derives builtin result shapes without executing a fill cell', () => {
        const never = () => { throw new Error('shape inference must not call the builtin'); };
        expect(native('sort', 1, never, 1).monadicResultShape?.([100_000])).toEqual([100_000]);
        expect(native('argsort', 1, never, 1).monadicResultShape?.([3])).toEqual([3]);
        expect(native('inverse', 1, never, 2).monadicResultShape?.([3, 3])).toEqual([3, 3]);
        expect(native('det', 1, never, 2).monadicResultShape?.([3, 3])).toEqual([]);
        expect(native('unique', 1, never, 1).monadicResultShape?.([3])).toBeUndefined();
        expect(native('inverse', 1, never, 2).monadicResultShape?.([2, 3])).toBeUndefined();
    });

    it('keeps large empty-frame cells without allocating or evaluating a prototype', () => {
        expect(shape('M = array shape 0 100000 fill 1\nR = M sort')).toBe('0 100000');
        expect(shape('use linalg\nM = array shape 0 300 300 fill 1\nR = M inverse')).toBe('0 300 300');
        expect(shape('M = array shape 0 0 fill 1\nR = M sort')).toBe('0 0');
    });

    it('keeps the rank of data-dependent builtin results', () => {
        expect(shape('M = array shape 0 3 fill 1\nR = M unique rank 1')).toBe('0 1');
    });

    it('uses the cell shape of explicit frame axes', () => {
        expect(shape('T = array shape 2 0 4 fill 1\nR = T sort axis 1 0 rank 1')).toBe('0 2 4');
        expect(shape('use linalg\nB = array shape 0 2 2 fill 1\nR = B det')).toBe('0');
    });

    it('derives user function results without calling them', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(String(line)));
        try {
            runtime.execute([
                'use io',
                'use numbers',
                'use sequences',
                'fun pair X',
                '  return array X X',
                'end',
                'fun twice X',
                '  return X * 2',
                'end',
                'fun shout X',
                '  X print',
                '  return array X X X',
                'end',
                'E = array shape 0 fill 1',
                'M = array shape 0 3 fill 1',
            ].join('\n'));
            const shapeOf = (expression: string) => formatValue(runtime.execute(`R = ${expression}\nR shape`)!);
            expect(shapeOf('E pair rank 0')).toBe('0 2');
            expect(shapeOf('M twice rank 1')).toBe('0 3');
            expect(shapeOf('E shout rank 0')).toBe('0 3');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('agrees in rank with the same application over a nonempty frame', () => {
        const source = (rows: number) => [
            'fun pair X',
            '  return array X X',
            'end',
            `A = array shape ${rows} fill 1`,
            'R = A pair rank 0',
        ].join('\n');
        expect(shape(source(0))).toBe('0 2');
        expect(shape(source(3))).toBe('3 2');
    });
});
