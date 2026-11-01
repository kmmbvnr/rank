import { expect, it } from 'vitest';
import { run } from './support.js';

const setup = 'V = array 10 20 30 40\nK = array 0 1 0 1\n';
it('reduces and scans by integer keys', () => {
    expect(run(setup + 'V reduce + by K')).toBe('40 60');
    expect(run(setup + 'V scan + by K with 100')).toBe('110 120 140 160');
    expect(run(setup + 'V reduce + by K size 4')).toBe('40 60 0 0');
});
it('calls an ordered user reducer', () => {
    expect(run('fun A sub B = A - B\n' + setup + 'V reduce sub by K')).toBe('-20 -20');
});
it('continues pipelines and accepts computed keys', () => {
    expect(run(setup + 'V reduce + by K sum')).toBe('100');
    expect(run('use sequences\nM = (array 1 2 3 4 5 6) reshape 2 3\nI = 0 to 1\nJ = 0 to 2\nM reduce + by (I J outer +)'))
        .toBe('1 6 8 6');
});
it('validates keys and conflicting modifiers', () => {
    expect(() => run(setup + 'V reduce + by (array 0)')).toThrow(/shape/);
    expect(() => run(setup + 'V reduce + by K size 1')).toThrow(/outside/);
    expect(() => run(setup + 'V reduce + by K axis 0')).toThrow(/by cannot/);
});
it('handles empty arrays and missing groups', () => {
    expect(run('E = array shape 0 fill 0\nE reduce + by E size 3')).toBe('0 0 0');
    expect(run('V = array 10 20\nK = array 1 3\nV reduce + by K')).toBe('0 10 0 20');
    expect(run('V = array 10 20\nK = array 1 3\nV scan + by K with 100')).toBe('110 120');
});
it.each(['sum', 'min', 'max', 'mean', 'median', 'mode', 'std', 'variance', 'var', 'skew', 'skewness'])(
    'groups the %s aggregate', operation => {
        const prefix = 'use stats\nV = array 1 2 3 4 5 6\nK = array 0 1 0 1 0 1\n';
        expect(run(prefix + `V ${operation} by K`)).toBe(run('use stats\n'
            + `array ((array 1 3 5) ${operation}) ((array 2 4 6) ${operation})`));
    });
it.each(['all', 'any', 'count'])('groups boolean %s', operation => {
    expect(run('use sequences\nV = array true false true true\nK = array 0 1 0 1\n'
        + `V ${operation} by K`)).toBe(run('use sequences\n'
        + `array ((array true true) ${operation}) ((array false true) ${operation})`));
});
it.each(['quantile 0.25', 'percentile 25', 'quantile', 'percentile'])(
    'groups %s with its ordinary parameter rules', operation => {
        expect(run('use stats\nV = array 1 2 3 4 5 6\nK = array 0 1 0 1 0 1\n'
            + `V ${operation} by K`)).toBe(run('use stats\n'
            + `array ((array 1 3 5) ${operation}) ((array 2 4 6) ${operation})`));
    });
it('validates singleton sums and skips missing aggregate samples', () => {
    expect(() => run('V = array true false\nK = array 0 1\nV sum by K')).toThrow();
    expect(() => run('V = array "x"\nK = array 0\nV sum by K')).toThrow(/numeric/);
    for (const operation of ['sum', 'min', 'max']) {
        expect(run('V = array 1 .NA 3 4\nK = array 0 0 1 1\n' + `V ${operation} by K`))
            .toBe(run(`array ((array 1 .NA) ${operation}) ((array 3 4) ${operation})`));
    }
    expect(run('V = array .NA\nK = array 0\nV sum by K')).toBe('0');
});

it('accepts a captured builtin aggregate alias', () => {
    expect(run('use stats\naverage = mean\n'
        + 'V = array 10 20 30 40\nK = array 0 1 0 1\nV average by K')).toBe('20 30');
    expect(run('use stats\naverage = mean\nV = array 10 20 30 40\nK = array 0 1 0 1\nV average by K sum')).toBe('50');
});

it('broadcasts group means back through ranked key addressing', () => {
    const source = 'use sequences\nuse stats\nV = (array 10 20 30 40) reshape 2 2\n'
        + 'K = (array 0 1 0 1) reshape 2 2\nMeans = V mean by K\nR = V - (Means K rank 0)';
    expect(run(source + '\nR')).toBe('-10 -10 10 10');
    expect(run(source + '\nR shape')).toBe('2 2');
});
it('scans an ordered user function with independent seeded states', () => {
    expect(run('fun A digits B = A * 10 + B\nV = array 1 2 3 4\nK = array 0 1 0 1\n'
        + 'V scan digits by K with 100')).toBe('1001 1002 10013 10024');
});
