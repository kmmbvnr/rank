import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
const services = createRankServices(EmptyFileSystem);
function analyze(source: string) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value);
}
it('rejects conflicting declaration returns without a call', () => {
    const result = analyze('fun pick X\n if X equal 0\n return 1\n else\n return true\n end\nend');
    expect(result.diagnostics.map(item => item.message)).toContain('pick returns incompatible types: integer and boolean');
});
it('checks both paths even when the only call selects one', () => {
    const result = analyze('fun pick X\n if X equal 0\n return array 1\n else\n return (array 1 2 3 4) reshape 2 2\n end\nend\n0 pick');
    expect(result.diagnostics.some(item => item.message.includes('returns incompatible ranks: 1 and 2'))).toBe(true);
});
it('keeps vector and matrix call facts separate', () => {
    const result = analyze('fun identity X\n return X\nend\nA = (array 1 2) identity\nB = ((array 1 2 3 4) reshape 2 2) identity');
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('A')?.rank).toBe(1);
    expect(result.bindings.get('B')?.rank).toBe(2);
});
it('checks tensor element types', () => {
    const result = analyze('fun pick X\n if X\n return array 1 2\n else\n return array "x"\n end\nend');
    expect(result.diagnostics.some(item => item.message.includes('returns incompatible types: integer and text'))).toBe(true);
});
it('checks nested declarations and returns inside try/finally', () => {
    for (const source of [
        'fun outer\n fun inner X\n if X\n return 1\n end\n return true\n end\n return 0\nend',
        'fun pick X\n try\n if X\n return 1\n end\n return true\n finally\n A = 0\n end\nend',
    ]) expect(analyze(source).diagnostics.some(item => item.message.includes('returns incompatible types'))).toBe(true);
});
it('does not conflate specializations selected by type guards', () => {
    const result = analyze('fun pick X\n if X is .integer\n return X\n else\n return array 1\n end\nend\nA = 1 pick\nB = (array 1 2) pick');
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('A')?.rank).toBe(0);
    expect(result.bindings.get('B')?.rank).toBe(1);
});
it('checks return types for equal ranks at separate call sites', () => {
    const result = analyze('fun pick X\n if X equal 0\n return 1\n end\n return true\nend\n0 pick\n1 pick');
    expect(result.diagnostics.some(item => item.message.includes('returns incompatible types'))).toBe(true);
});
it('analyzes recursion separately when the argument rank changes', () => {
    const result = analyze('fun scalar X\n if X is .array\n return (X 0) scalar\n end\n return X\nend\nA = (array 7) scalar');
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('A')).toMatchObject({ types: ['integer'], rank: 0 });
});
it('does not share return contracts between separate closures', () => {
    const result = analyze('fun outer X\n fun value\n return X\n end\n return value\nend\nA = 1 outer\nB = true outer');
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('A')?.types).toEqual(['integer']);
    expect(result.bindings.get('B')?.types).toEqual(['boolean']);
});
it('checks catch returns after an unconditional raise', () => {
    const result = analyze('fun pick Flag\n if Flag\n return 1\n end\n try\n .Oops raise\n catch Error\n return true\n end\nend');
    expect(result.diagnostics.some(item => item.message.includes('returns incompatible types'))).toBe(true);
});
it('retains the vector and matrix ranks of normalization results', () => {
    const result = analyze('use numbers\nfun normalize V\n Min = V min\n Max = V max\n return (V - Min) / (Max - Min)\nend\nA = (array 2 4) normalize\nB = (array 2 4 6 8 shape 2 2) normalize');
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('A')).toMatchObject({ rank: 1 });
    expect(result.bindings.get('B')).toMatchObject({ rank: 2 });
});
