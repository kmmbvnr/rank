import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

for (const compilation of [false, true]) describe(`pure mask reductions (compiled=${compilation})`, () => {
    function run(source: string): string {
        const runtime = new Interpreter(() => {}, { compilation });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    }
    const imports = 'use sequences\nuse numbers\nuse stats\n';
    const sources = ['array 1 2 3 4 5', '1 to 5', 'fibonacci till 100'];

    it.each(['sum', 'lcm', 'mean', 'median', 'std', 'variance', 'var', 'skewness', 'skew',
        'quantile', 'percentile'])('rejects %s consistently for inline, stored and deferred masks', operation => {
        for (const source of sources) {
            const setup = `${imports}A = ${source}\n`;
            for (const predicate of ['even', 'greater 2', 'even or (A greater 2)', 'not (A even)']) {
                const expression = predicate.startsWith('not ') ? predicate : `A ${predicate}`;
                for (const program of [`(${expression}) ${operation}`, `Mask = ${expression}\nMask ${operation}`,
                    `Mask' = ${expression}\nMask ${operation}`]) {
                    expect(() => run(setup + program)).toThrow(/expects numbers, not a boolean mask.*filter.*Mask count/);
                }
            }
        }
    });

    it('keeps filtering and explicit selection invariant under variable extraction', () => {
        for (const [source, expected] of [[sources[0], '6'], [sources[1], '6'], [sources[2], '44']]) {
            const setup = `${imports}A = ${source}\n`;
            for (const program of ['A filter even sum', 'Selected = A filter even\nSelected sum',
                "Selected' = A filter even\nSelected sum", 'A (A even) sum', 'Mask = A even\nA Mask sum']) {
                expect(run(setup + program)).toBe(expected);
            }
        }
    });

    it('reduces flags themselves with ordered extrema and boolean consumers', () => {
        for (const source of sources) {
            const setup = `${imports}A = ${source}\n`;
            for (const binding of ['', 'Mask = A even\n', "Mask' = A even\n"]) {
                const mask = binding ? 'Mask' : '(A even)';
                expect(run(setup + binding + `${mask} min`)).toBe('false');
                expect(run(setup + binding + `${mask} max`)).toBe('true');
                expect(run(setup + binding + `${mask} min .index`)).toBe('0');
                expect(run(setup + binding + `${mask} max .index`)).toBe('1');
                expect(run(setup + binding + `${mask} count`)).toBe(source.includes('fibonacci') ? '3' : '2');
            }
        }
        expect(run(imports + '(array true false) min')).toBe('false');
        expect(run(imports + '(array true false) max')).toBe('true');
        expect(run(imports + '((array 1 2 3 4) reshape 2 2) even min')).toBe('false');
    });

    it('reads all-true and all-false masks without substituting their source', () => {
        const setup = `${imports}A = array 1 2 3\n`;
        for (const [predicate, flag] of [['greater 0', 'true'], ['greater 99', 'false']]) {
            for (const operation of ['min', 'max']) {
                expect(run(setup + `A ${predicate} ${operation}`)).toBe(flag);
                expect(run(setup + `Mask = A ${predicate}\nMask ${operation}`)).toBe(flag);
            }
        }
        for (const predicate of ['present', 'isnan']) {
            expect(() => run(setup + `A ${predicate} sum`)).toThrow(/boolean mask/);
            expect(() => run(setup + `Mask = A ${predicate}\nMask sum`)).toThrow(/boolean mask/);
        }
        expect(() => run(setup + '(A even) quantile 0.5')).toThrow(/boolean mask/);
        expect(() => run(setup + 'Mask = A even\nMask percentile 50')).toThrow(/boolean mask/);
    });

    it('keeps empty reductions and unbounded mask diagnostics consistent', () => {
        const expression = '(1 till 1) even';
        for (const binding of ['', `Mask = ${expression}\n`, `Mask' = ${expression}\n`]) {
            expect(run(imports + binding + (binding ? 'Mask' : `(${expression})`) + ' sum')).toBe('0');
        }
        expect(() => run(imports + 'fibonacci even sum')).toThrow(/boolean mask.*filter/);
        expect(run(imports + 'fibonacci filter even till 100 sum')).toBe('44');
    });
});
