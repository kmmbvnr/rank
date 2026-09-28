import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function analyze(source: string, initial = new Map<string, ValueFacts>()) {
    const parsed = parser.parse<Program>(source + '\n');
    expect(parsed.parserErrors.map(error => error.message)).toEqual([]);
    return analyzeValues(parsed.value, initial);
}
const messages = (source: string) => analyze(source).diagnostics.map(item => item.message);
const vector = 'R = record\n .items = array 1 2\nend\n';

describe('structural record facts', () => {
    it('keeps rank and cell types but drops axis lengths', () => {
        expect(analyze(vector + 'X = R .items').bindings.get('X'))
            .toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
        expect(messages(vector + 'R .items = array 3 4 5')).toEqual([]);
    });

    it('checks rank and cells through direct aliases', () => {
        expect(messages(vector + 'Alias = R\nAlias .items = array shape 1 2 fill 0'))
            .toContain('record field .items has rank 1 and cannot receive rank 2');
        expect(messages(vector + 'Alias = R\nAlias .items = array "text"'))
            .toContain('record field .items has array cells of type integer and cannot receive text');
        expect(messages('R = record\n .count = 1\nend\nR .count /= 2'))
            .toContain('record field .count has type integer and cannot receive real');
    });

    it('checks with copies and keeps the original contract', () => {
        expect(messages(vector + 'S = R with\n .items = array shape 1 2 fill 0\nend'))
            .toContain('record field .items has rank 1 and cannot receive rank 2');
        expect(analyze(vector + 'S = R with\n .items = array 3 4 5\nend\nX = S .items').bindings.get('X'))
            .toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
    });

    it('checks nested field names, types and direct nested writes', () => {
        const source = 'R = record\n .point = record\n .x = 1\n end\nend\n';
        expect(messages(source + 'R .point = record\n .y = 1\nend')[0]).toMatch(/fields .x.*fields .y/);
        expect(messages(source + 'R .point .x = "bad"'))
            .toContain('record field .point .x has type integer and cannot receive text');
    });

    it('rejects different return schemas before the function is called', () => {
        for (const right of ['.other = 1', '.value = "bad"', '.value = array 1']) {
            const errors = messages(`fun pick Flag\n if Flag\n return record\n .value = 1\n end\n end\n return record\n ${right}\n end\nend`);
            expect(errors.some(error => error.includes('returns incompatible record types'))).toBe(true);
        }
    });

    it('checks nested ranks on recursive returns', () => {
        const source = 'fun build N\n if N equal 0\n return record\n .inner = record\n .data = array 1\n end\n end\n end\n Previous = (N - 1) build\n return record\n .inner = record\n .data = array shape 1 1 fill 1\n end\n end\nend\nX = 1 build';
        expect(messages(source).some(error => error.includes('returns incompatible record types'))).toBe(true);
    });

    it('separates record argument schemas while allowing different axis lengths', () => {
        const analysis = analyze('fun identity R\n return R\nend\nA = record\n .x = 1\nend\nB = record\n .name = "text"\nend\nC = A identity\nD = B identity');
        expect(analysis.diagnostics.map(item => item.message)).toEqual([]);
        expect(analysis.bindings.get('C')?.fields?.x.types).toEqual(['integer']);
        expect(analysis.bindings.get('D')?.fields?.name.types).toEqual(['text']);
    });

    it('does not invent fields for unknown record parameters', () => {
        const result = analyze('fun read R\n return R .items\nend\nX = Unknown read');
        expect(result.bindings.get('X')?.rank).toBeUndefined();
        expect(result.diagnostics.map(item => item.message)).toEqual([]);
    });

    it('does not treat an empty array fill as an established cell type', () => {
        expect(messages('R = record\n .items = array shape 0 fill 0\nend\nR .items = array "ok"')).toEqual([]);
    });
});
