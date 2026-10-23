import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    return formatValue(runtime.execute(source)!);
}

describe('fun headers declare intrinsic ranks', () => {
    it('a dyadic function maps over its declared cell ranks', () => {
        const inc = 'fun X inc Y rank 0 0\n  return X + Y\nend\n';
        expect(run(inc + '(array 1 2) inc (array 10 20)')).toBe('11 22');
        expect(run(inc + '(array 1 2) inc 5')).toBe('6 7');
    });

    it('a monadic function maps over its cells', () => {
        const row = 'fun Row total rank 1\n  return Row sum\nend\n';
        expect(run(row + '((array 1 2 3 4) reshape 2 2) total')).toBe('3 7');
    });

    it('all keeps the whole operand and a negative rank counts from the operand', () => {
        const f = 'fun X f Y rank 0 all\n  return X + Y sum\nend\n';
        expect(run(f + '(array 1 2) f (array 10 20)')).toBe('32 34');
        const g = 'fun Row g rank -1\n  return Row sum\nend\n';
        expect(run(g + '((array 1 2 3 4) reshape 2 2) g')).toBe('3 7');
    });

    it('a call-site rank overrides the declaration', () => {
        const inc = 'fun X inc Y rank 0 0\n  return X + Y\nend\n';
        expect(run(inc + '(array 1 2) inc 5 rank 0 0')).toBe('6 7');
    });

    it('array results stack under the frame', () => {
        const pair = 'fun X pair rank 0\n  return (array X (X + 1))\nend\n';
        expect(run(pair + '(array 1 2) pair shape')).toBe('2 2');
    });

    it('call-site binary ranks stack array results without header ranks', () => {
        const pair = 'fun X pair Y\n  return array X Y\nend\n';
        expect(run(pair + 'R = (array 1 2) pair 5 rank 0 0\nR shape')).toBe('2 2');
        expect(run(pair + '(array 1 2) pair 5 rank 0 0')).toBe('1 5 2 5');
        expect(run(pair + '(array shape 0 fill 0) pair 5 rank 0 0 shape')).toBe('0 2');
    });

    it('rank stays an ordinary word elsewhere', () => {
        expect(run('fun X f\n  return X + 1\nend\n(array 1 2) f')).toBe('2 3');
    });

    it('rejects a clause that does not match the parameters', () => {
        expect(() => run('fun X f Y rank 0\n  return X\nend\n1 f 2')).toThrow(/rank expects 2 entries/);
        expect(() => run('fun f rank 0\n  return 1\nend')).toThrow(/needs a function with parameters/);
    });
});

describe('ragged lifts', () => {
    it('checks array result uniformity for binary call-site ranks without header ranks', () => {
        const distinct = 'fun Row distinct Ignored\n  return Row unique\nend\n';
        expect(() => run(`${distinct}(array 1 1 2 3 shape 2 2) distinct 0 rank 1 0`))
            .toThrow(/ranked results must have the same shape: 1 and 2/);
    });

    it('name the function and the two cell shapes', () => {
        const rows = '(array 1 1 2 3) reshape 2 2';
        expect(() => run(`(${rows}) unique rank 1`)).toThrow(/`unique` gave 1 and 2 \(cell 1\)/);
        const distinct = 'fun Row distinct\n  return Row unique sum\nend\n';
        expect(run(`${distinct}(${rows}) distinct rank 1`)).toBe('1 5');
    });
});
