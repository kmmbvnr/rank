import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { derivedArray } from '../src/array-storage.js';

for (const compilation of [false, true]) describe(`tensor indices (compiled=${compilation})`, () => {
    function check(source: string, shape: number[], values: string) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const result = runtime.execute('use sequences\n' + source);
            expect(result).toMatchObject({ shape });
            expect(formatValue(result!)).toBe(values);
        } finally { runtime.dispose(); }
    }

    it('returns coordinate rows in logical row-major order', () => {
        check('M = (array false true false true false true) reshape 2 3\nM indices',
            [3, 2], '0 1 1 0 1 2');
        check('M = (array false true false true false false true false) reshape 2 2 2\nM indices',
            [3, 3], '0 0 1 0 1 1 1 1 0');
        check('(array shape 2 2 fill true) indices', [4, 2], '0 0 0 1 1 0 1 1');
    });

    it('preserves vector results and singleton coordinate rows', () => {
        check('(array true false true) indices', [2], '0 2');
        check('(array false false) indices', [0], '');
        check('(array true) indices', [1], '0');
        check('(array shape 1 1 1 fill true) indices', [1, 3], '0 0 0');
    });

    it('retains coordinate width for false and empty masks', () => {
        for (const dimensions of ['2 3', '0 3', '3 0', '2 0 3', '2 2 2']) {
            check(`(array shape ${dimensions} fill false) indices`, [0, dimensions.split(' ').length], '');
        }
        check('(array shape 0 fill 42) indices', [0], '');
        check('(array shape 0 3 fill 42) indices', [0, 2], '');
    });

    it('uses the logical coordinates of transposes and slices', () => {
        const setup = 'M = (array false true false true false true) reshape 2 3\n';
        check(setup + 'M transpose indices', [3, 2], '0 1 1 0 2 1');
        check(setup + '(M # (1 to 2)) indices', [2, 2], '0 0 1 1');
    });

    it('reads computed mask cells once, in order, and stores the result', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const reads: number[] = [];
        try {
            runtime.variables.set('Mask', derivedArray([2, 3], [], index => {
                reads.push(index);
                return index % 2 === 1;
            }));
            runtime.execute('use sequences\nWhere = Mask indices');
            expect(formatValue(runtime.execute('Where')!)).toBe('0 1 1 0 1 2');
            expect(formatValue(runtime.execute('Where')!)).toBe('0 1 1 0 1 2');
            expect(reads).toEqual([0, 1, 2, 3, 4, 5]);
        } finally { runtime.dispose(); }
    });

    it('runs the queens demo with small boards and empty solution sets', () => {
        const demo = readFileSync(new URL('../../../demos/classic/queens.ra', import.meta.url), 'utf8');
        expect(demo).toContain('Size = 8');
        for (const [size, count] of [[1, 1], [2, 0], [3, 0], [4, 2], [8, 92]]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(demo.replace('Size = 8', `Size = ${size}`));
                expect(runtime.variables.get('States')).toMatchObject({ shape: [count, size] });
                expect(runtime.variables.get('Boards')).toMatchObject({ shape: [count, size, size] });
                if (size === 1) expect(formatValue(runtime.execute('Boards')!)).toBe('Q');
                if (size === 4) {
                    expect(formatValue(runtime.execute('States')!)).toBe('1 3 0 2 2 0 3 1');
                    expect(formatValue(runtime.execute('Boards')!)).toBe(
                        '. Q . . . . . Q Q . . . . . Q . . . Q . Q . . . . . . Q . Q . .');
                }
            } finally { runtime.dispose(); }
        }
    });

    it('grows queens placements by one column per placed queen', () => {
        const demo = readFileSync(new URL('../../../demos/classic/queens.ra', import.meta.url), 'utf8');
        const traced = demo.split('States len print')[0]
            .replace('States = Cols reshape Size 1', 'States = Cols reshape Size 1\nStates shape print')
            .replace('States = concat Prev Col axis 1',
                'States = concat Prev Col axis 1\n  States shape print');
        const shapes: string[] = [];
        const runtime = new Interpreter(text => shapes.push(text), { compilation });
        try {
            runtime.execute(traced);
            expect(shapes).toEqual(['8 1', '42 2', '140 3', '344 4', '568 5', '550 6', '312 7', '92 8']);
        } finally { runtime.dispose(); }
    });

    it('rejects scalars and non-boolean cells', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use sequences');
            expect(() => runtime.execute('true indices')).toThrow('indices expects an array of rank at least 1');
            expect(() => runtime.execute('(array shape 2 2 fill 1) indices')).toThrow('indices expects boolean values');
        } finally { runtime.dispose(); }
    });
});
