import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

const prefix = 'use sequences\nuse stats\nuse random\nuse linalg\nM = (1 to 6) reshape 2 3\n';
describe.each([false, true])('negative tensor axes (compilation=%s)', compilation => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    };
    const forms = [
        'M reduce + axis AX', 'M reduce * axis AX with 1', 'M scan + axis AX',
        'M reduce max axis AX', 'M scan max axis AX',
        ...['sum', 'min', 'max', 'mean', 'std'].map(op => `M ${op} axis AX`),
        ...['all', 'any', 'count'].map(op => `B = M greater 3\nB ${op} axis AX`),
        'M mse M axis AX', 'M mae M axis AX', 'M reverse axis AX',
        'M shift 1 axis AX', 'concat M M axis AX', 'M window 2 axis AX',
        'M M equal axis AX',
        'M len axis AX', 'M argsort axis AX', 'M shuffle 42 axis AX',
        'M quantile 0.5 axis AX',
        'fun X flip\n return X reverse\nend\nM flip axis AX',
        'Total = 0\nfor Col j in (M reverse axis AX)\n Total += Col sum * (j + 1)\nend\nTotal',
    ];
    it.each(forms)('%s agrees with the normalized axis', form => {
        for (const [negative, positive] of [['-1', '1'], ['-2', '0']]) {
            expect(run(prefix + form.replace('AX', negative))).toBe(run(prefix + form.replace('AX', positive)));
        }
    });
    it('normalizes contraction axes independently for each operand', () => {
        expect(run(prefix + 'M matmul M axis -1 -1')).toBe(run(prefix + 'M matmul M axis 1 1'));
        expect(run(prefix + 'M covariance axis -2 -1')).toBe(run(prefix + 'M covariance axis 0 1'));
    });
    it('normalizes multiple axes and preserves permutation order', () => {
        expect(run(prefix + 'M transpose axis -1 -2')).toBe('1 4 2 5 3 6');
        expect(run(prefix + 'M reduce + axis -2 -1 with 0')).toBe('21');
    });
    it('keeps trailing-axis helpers independent of the frame rank', () => {
        const helper = 'products = reduce * axis -1 max\n';
        expect(run(prefix + helper + 'M products')).toBe('120');
        expect(run(prefix + helper + 'T = (1 to 12) reshape 2 2 3\nT products')).toBe('1320');
    });
    it('normalizes relative to the whole tensor before checking input cells', () => {
        expect(run(prefix + 'M reduce + rank 1 axis -2')).toBe('5 7 9');
        expect(() => run(prefix + 'M reduce + rank 1 axis -1')).toThrow('outside the trailing input cell');
    });
    it.each(['M reduce + axis AX', 'M sum axis AX', 'M reverse axis AX', 'M window 1 1 axis AX',
        'M transpose axis AX', 'M M equal axis AX'])('rejects normalized duplicate axes: %s', form => {
        expect(() => run(prefix + form.replace('AX', '1 -1'))).toThrow('unique');
    });
    it.each(['M reduce + axis -3', 'M sum axis -3', 'M reverse axis -3', 'M scan + axis -3',
        'M window 1 axis -3', 'concat M M axis -3'])('rejects out-of-range axes: %s', form => {
        expect(() => run(prefix + form)).toThrow(/(axis.*(bounds|invalid|rank)|has no axis)/);
    });
    it('rejects scalar and unsafe axes without clamping', () => {
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Scalar', { kind: 'array', shape: [], items: [1n] });
        try { expect(() => runtime.execute('use sequences\nScalar reverse axis -1')).toThrow('axis out of bounds'); }
        finally { runtime.dispose(); }
        expect(() => run(prefix + 'M reverse axis -9007199254740992')).toThrow('too large');
    });
    it('keeps spaced subtraction and empty tensor shapes', () => {
        expect(run(prefix + 'M reduce + axis 1 - 1')).toBe('5 14');
        expect(run('use sequences\nE = array shape 2 0 fill 0\nE reduce + axis -1')).toBe('0 0');
        expect(run('use sequences\nE = array shape 0 3 fill 0\nE reverse axis -1 shape')).toBe('0 3');
    });
});
