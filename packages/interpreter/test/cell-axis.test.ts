import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

describe.each([false, true])('explicit operation cell axes (compilation=%s)', compilation => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try { const result = runtime.execute(source); return result === undefined ? undefined : formatValue(result); }
        finally { runtime.dispose(); }
    };
    const matrix = 'use sequences\nM = (1 to 6) reshape 2 3\n';
    it('reverses columns and rows without changing their placement', () => {
        expect(run(matrix + 'M reverse axis 0')).toBe(run(matrix + 'M reverse'));
        expect(run(matrix + 'M reverse axis 1')).toBe(run(matrix + 'M transpose reverse transpose'));
    });
    it('selects noncontiguous cells and restores same-rank results', () => {
        const source = 'use sequences\nT = (1 to 24) reshape 2 3 4\nfun X flip\n return X reverse\nend\n';
        expect(run(source + 'T flip axis 0 2')).toBe(run(source + 'T reverse'));
        expect(run(source + 'T flip axis 2 0')).toBe(run(source + 'T flip axis 0 2'));
        expect(run(source + 'T flip axis 0 2 shape')).toBe('2 3 4');
    });
    it('stacks rank-changing results after the remaining frame', () => {
        const source = 'use sequences\nT = (1 to 24) reshape 2 3 4\nfun X total\n return X sum\nend\n';
        expect(run(source + 'T total axis 0 2')).toBe(run(source + 'T sum axis 0 2'));
    });
    it('iterates columns with indices in the complementary frame', () => {
        expect(run(matrix + 'Total = 0\nfor Col j in M axis 0\n Total += Col sum * (j + 1)\nend\nTotal')).toBe('46');
    });
    it('compares selected cells', () => {
        expect(run(matrix + 'M M equal axis 0')).toBe('true true true');
    });
    it('rejects repeated, invalid or conflicting axes', () => {
        expect(() => run(matrix + 'M reverse axis 0 0')).toThrow('unique');
        expect(() => run(matrix + 'M reverse axis 2')).toThrow('out of bounds');
        expect(() => run(matrix + 'M reverse axis 0 rank 2')).toThrow('must equal cell rank');
    });
    it('preserves empty frame placement and empty cells', () => {
        expect(run('use sequences\nM = array shape 3 0 fill 0\nM reverse axis 0 shape')).toBe('3 0');
        expect(run('use sequences\nM = array shape 0 3 fill 0\nM reverse axis 0 shape')).toBe('0 3');
    });
    it('restores changed lengths by axis position and rejects ragged cells', () => {
        const source = 'use linalg\n' + matrix + 'fun X endpoints\n return array (X 0) (X 0) (X 1)\nend\n';
        expect(run(source + 'M endpoints axis 0 shape')).toBe('3 3');
        expect(run(source + 'M endpoints axis 0')).toBe('1 2 3 1 2 3 4 5 6');
        expect(run('use linalg\n' + matrix + 'M diag axis 0 1')).toBe('1 5');
        expect(() => run('use sequences\nM = array 1 1 2 3 shape 2 2\nM unique axis 1')).toThrow('one shape');
    });
    it('retains rank-only assembly and supports aliases and matching rank assertions', () => {
        expect(run(matrix + 'flipped = reverse\nM flipped axis 0 rank 1')).toBe(run(matrix + 'M reverse axis 0'));
        expect(run(matrix + 'M reverse rank 1')).toBe(run(matrix + 'M reverse axis 1'));
    });
    it('keeps operation-specific contractions and window axes', () => {
        expect(run('use linalg\n' + matrix + 'M M matmul axis 0 0')).toBe(run('use linalg\n' + matrix + 'M transpose M matmul'));
        expect(run('use linalg\n' + matrix + 'M M matmul axis 1 1')).toBe(run('use linalg\n' + matrix + 'M (M transpose) matmul'));
        expect(run(matrix + 'M window 2 axis 0 shape')).toBe('1 3 2');
    });

});
