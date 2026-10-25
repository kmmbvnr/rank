import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

const matrix = 'use sequences\nuse stats\nM = (1 to 15) reshape 3 5\n';
describe.each([false, true])('leading-axis loops (compilation=%s)', compilation => {
    function run(source: string) {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    }
    it.each(['rank 0', 'rank 1', 'axis 0 rank 1'])(
        'rejects removed modifiers: %s', modifier => {
            expect(() => run(matrix + `for Cell in M ${modifier}\n Cell\nend`))
                .toThrow('for does not accept rank');
        });
    it.each(['M', 'array shape 0 5 fill 0'])('rejects multiple indices even for empty sources: %s', source => {
        expect(() => run(matrix + `for Cell i j in ${source}\n Cell\nend`))
            .toThrow('at most one index name');
    });
    it('visits exactly three rows with their indices', () => {
        expect(run(matrix + 'Total = 0\nfor Row i in M\n Total += Row len + i\nend\nTotal')).toBe('18');
    });
    it.each([false, true])('keeps ordinary source operations, parenthesized=%s', grouped => {
        const source = (expression: string) => grouped ? `(${expression})` : expression;
        expect(run(matrix + `Total = 0.0\nfor V in ${source('M mean axis 0')}\n Total += V\nend\nTotal`)).toBe('40');
        expect(run(matrix + `Total = 0\nfor V in ${source('M sum rank 1')}\n Total += V\nend\nTotal`)).toBe('120');
    });
    it.each(['0 5', '3 0'])('keeps empty leading axes and empty row cells: %s', shape => {
        const rows = shape === '0 5' ? 0 : 3;
        expect(run(`M = array shape ${shape} fill 0\nCount = 0\nfor Row i in M\n Count += 1\nend\nCount`)).toBe(String(rows));
    });
});
