import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

for (const compilation of [false, true]) describe(`fold pipelines (${compilation})`, () => {
    const prefix = 'use numbers\nuse sequences\nuse algo\n'
        + 'M = array true false true\nV = array 2 4 6\n';
    it.each([
        ['M choose V 0 scan max', '2 2 6'],
        ['M V 0 choose scan max', '2 2 6'],
        ['M choose V 0 scan min', '2 0 0'],
        ['M choose V 0 scan max with 3', '3 3 3 6'],
        ['M choose V 0 scan max sum', '10'],
        ['M choose V 0 scan max scan min', '2 2 2'],
        ['M choose V 0 scan + scan max', '2 2 8'],
        ['M choose V 0 reduce max', '6'],
        ['M choose V 0 reduce min', '0'],
        ['M choose V 0 scan +', '2 2 8'],
        ['M choose V 0 reduce +', '8'],
        ['V abs scan max', '2 4 6'],
        ['V reverse scan max', '6 6 6'],
        ['V abs reduce min', '2'],
        ['M choose V 0 segment max 0 2 query', '6'],
        ['1 choose (array (array 1 2) (array 3 4)) scan max', '3 4'],
        ['M choose V 0 scan plus', '2 2 8'],
        ['M choose V 0 scan plus with 1 sum', '16'],
        ['M choose V 0 scan bigger', '2 2 6'],
        ['M choose V 0 reduce bigger', '6'],
        ['(array 1 2) (array 3 4) outer max', '3 4 3 4'],
    ])('executes %s', (source, expected) => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            expect(formatValue(runtime.execute(prefix
                + 'fun A bigger B = A max B\nfun A plus B = A + B\n' + source)!)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('retains rank and axis on the fold', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            expect(formatValue(runtime.execute(prefix
                + 'A = (array 1 5 3 2) reshape 2 2\n'
                + 'true choose A 0 scan max axis 0')!)).toBe('1 5 3 5');
        } finally { runtime.dispose(); }
    });

    it('evaluates scalar alternatives before folding', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            expect(() => runtime.execute(prefix + 'true choose V (7 // 0) scan max'))
                .toThrow('division by zero');
        } finally { runtime.dispose(); }
    });
});
