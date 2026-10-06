import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { analyzeValues } from '@arrrank/language';
import { type RankArray } from '../src/value.js';

for (const compiled of [true, false]) describe(`window dimensions (compiled ${compiled})`, () => {
    const run = (source: string) => {
        const r = new Interpreter(() => {}, { scalarCompilation: compiled,
            integerLoopCompilation: compiled, tensorCellCompilation: compiled });
        return formatValue(r.execute(`use sequences\nuse linalg\n${source}`)!);
    };
    const grid = 'M = array 1 2 3 4 5 6 7 8 9 shape 3 3\nS = array 2 2\n';
    it('agrees on direct, named, grouped and unpacked dimensions', () => {
        const expected = run(`${grid}M window S`);
        for (const sizes of ['2 2', 'S', 'unpack S', 'unpack (tuple 2 2)', '(1 + 1) 2', '2 unpack (array 2)']) {
            expect(run(`${grid}M window ${sizes}`)).toBe(expected);
        }
        expect(run(`${grid}Rows = 2\nColumns = 2\nM window Rows Columns shape`)).toBe('2 2 2 2');
    });
    it('continues builtin and user function pipelines and preserves source pipelines', () => {
        expect(run(`${grid}M window 2 2 diag`)).toBe('1 5 2 6 4 8 5 9');
        expect(run(`${grid}M window unpack S diag .anti`)).toBe('2 4 3 5 5 7 6 8');
        expect(run(`${grid}products = reduce * rank 1 max\nM window 2 2 diag products`)).toBe('45');
        expect(run(`${grid}M reverse window 2 2 shape`)).toBe('2 2 2 2');
        expect(run('(1 to 5) window 3 copy shape')).toBe('3 3');
        expect(run('"abcd" window 2 array len')).toBe('3');
    });
    it('keeps geometry and selected-axis ordering', () => {
        expect(run(`${grid}M window 2 2 stride 2 padding 1 with 9 shape`)).toBe('2 2 2 2');
        expect(run(`${grid}M window unpack S stride (array 1 2) padding (array 0 1) axis 0 1 shape`)).toBe('2 2 2 2');
        expect(run('T = array shape 3 4 5 fill 1\nT window 2 3 axis 0 2 shape')).toBe('2 4 3 2 3');
        expect(run('T = array shape 3 4 5 fill 1\nT window 3 2 axis 2 0 shape')).toBe('2 4 3 3 2');
        expect(run(`${grid}M window 2 axis 1 shape`)).toBe('3 2 2');
    });
    it('preserves empty window cell shapes', () => {
        expect(run('M = array shape 0 5 fill 1\nM window 2 3 shape')).toBe('0 3 2 3');
        expect(run(`${grid}M window 4 4 shape`)).toBe('0 0 4 4');
    });
    it.each(['2', '2 2 2', '2 0', '2 -1', '2 1.5', '2 "x"', 'unpack (array shape 0 fill 0)'])
    ('rejects invalid sizes: %s', sizes => {
        expect(() => run(`${grid}M window ${sizes}`)).toThrow();
    });
    it('evaluates computed and unpacked sizes exactly once', () => {
        expect(run('State = record\n .count = 0\nend\nfun sizes\n State .count += 1\n return array 2 2\nend\n'
            + `${grid}W = M window unpack (sizes)\nState .count`)).toBe('1');
        expect(run('State = record\n .count = 0\nend\nfun size X\n State .count += 1\n return X\nend\n'
            + `${grid}W = M window (2 size) (2 size)\nState .count`)).toBe('2');
    });
    it('respects a user-defined window and explicit rank on old calls', () => {
        expect(new Interpreter().execute('fun window X Y\n return X + Y\nend\n1 2 window')).toBe(3n);
        expect(run(`${grid}fun sliding X rank 1\n return X window 2\nend\nM sliding shape`)).toBe('3 2 2');
    });
    it('keeps runtime and analysis shapes consistent', () => {
        const source = `use sequences\nuse linalg\n${grid}A = M window 2 2\nB = M window unpack S\nC = M window 2 2 diag\nD = M window 2 2 axis 0 1`;
        const r = new Interpreter(); r.execute(source);
        const facts = analyzeValues(parse(source));
        expect(facts.diagnostics).toEqual([]);
        for (const name of ['A', 'B', 'C', 'D']) {
            expect(facts.bindings.get(name)?.shape).toEqual((r.variables.get(name) as RankArray).shape);
        }
    });
});

it('does not read source cells when window dimensions are unpacked', () => {
    const r = new Interpreter(); r.execute('use sequences');
    let reads = 0;
    r.variables.set('M', { kind: 'array', shape: [3, 3], items: [],
        itemAt: i => { reads++; return BigInt(i); } } as RankArray);
    r.execute('S = array 2 2\nW = M window unpack S');
    expect(reads).toBe(0);
    expect(r.execute('W 0 0 0 0')).toBe(0n);
    expect(reads).toBe(1);
});
