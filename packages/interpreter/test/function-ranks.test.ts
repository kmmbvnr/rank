import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    return formatValue(runtime.execute(source)!);
}

describe('fun headers declare intrinsic ranks', () => {
    it('a dyadic function maps over its declared cell ranks', () => {
        const inc = 'fun inc X Y rank 0 0\n  return X + Y\nend\n';
        expect(run(inc + '(array 1 2) (array 10 20) inc')).toBe('11 22');
        expect(run(inc + '(array 1 2) 5 inc')).toBe('6 7');
    });

    it('a monadic function maps over its cells', () => {
        const row = 'fun total Row rank 1\n  return Row sum\nend\n';
        expect(run(row + '((array 1 2 3 4) reshape 2 2) total')).toBe('3 7');
    });

    it('all keeps the whole operand and a negative rank counts from the operand', () => {
        const f = 'fun f X Y rank 0 all\n  return X + Y sum\nend\n';
        expect(run(f + '(array 1 2) (array 10 20) f')).toBe('32 34');
        const g = 'fun g Row rank -1\n  return Row sum\nend\n';
        expect(run(g + '((array 1 2 3 4) reshape 2 2) g')).toBe('3 7');
    });

    it('a call-site rank overrides the declaration', () => {
        const inc = 'fun inc X Y rank 0 0\n  return X + Y\nend\n';
        expect(run(inc + '(array 1 2) 5 inc rank 0 0')).toBe('6 7');
    });

    it('array results stack under the frame', () => {
        const pair = 'fun pair X rank 0\n  return (array X (X + 1))\nend\n';
        expect(run(pair + '(array 1 2) pair shape')).toBe('2 2');
    });

    it('rank stays an ordinary word elsewhere', () => {
        expect(run('fun f X\n  return X + 1\nend\n(array 1 2) f')).toBe('2 3');
    });

    it('rejects a clause that does not match the parameters', () => {
        expect(() => run('fun f X Y rank 0\n  return X\nend\n1 2 f')).toThrow(/rank expects 2 entries/);
        expect(() => run('fun f rank 0\n  return 1\nend')).toThrow(/needs a function with parameters/);
    });
});

describe('ragged lifts', () => {
    it('name the function and the two cell shapes', () => {
        const rows = '(array 1 1 2 3) reshape 2 2';
        expect(() => run(`(${rows}) unique rank 1`)).toThrow(/`unique` gave 1 and 2 \(cell 1\)/);
        const distinct = 'fun distinct Row\n  return Row unique sum\nend\n';
        expect(run(`${distinct}(${rows}) distinct rank 1`)).toBe('1 5');
    });
});
