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

describe('ordinary record binding schemas', () => {
    it('rejects different field names, types and ranks', () => {
        for (const field of ['.other = 1', '.items = "bad"', '.items = array "bad"', '.items = array shape 1 1 fill 0']) {
            expect(messages(vector + `R = record\n ${field}\nend`).some(message => message.includes('R') && message.includes('cannot receive'))).toBe(true);
        }
    });
    it('retains the established schema through empty and missing replacements', () => {
        expect(messages(vector + 'R = .NA\nR = record\n .items = array "bad"\nend').some(message => message.includes('integer'))).toBe(true);
        expect(messages(vector + 'R = record\n .items = array shape 0 fill 0\nend\nR .items = array "bad"'))
            .toContain('record field .items has array cells of type integer and cannot receive text');
    });
    it('settles an initially empty field on a whole-record assignment', () => {
        expect(messages('R = record\n .items = array shape 0 fill 0\nend\n' + vector + 'R = record\n .items = array "bad"\nend')
            .some(message => message.includes('integer') && message.includes('text'))).toBe(true);
    });
    it('allows compatible assignments without keeping stale lengths', () => {
        const result = analyze(vector + 'R = record\n .items = array 3 4 5\nend\nX = R .items');
        expect(result.diagnostics).toEqual([]);
        expect(result.bindings.get('X')).toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
    });
});

it('retains record contracts across callbacks while forgetting values and lengths', () => {
    const result = analyze('fun apply F\n R = record\n .items = array 1 2\n .count = 7\n end\n 0 F\n return R\nend\nX = Callback apply');
    expect(result.bindings.get('X')).toMatchObject({ types: ['record'], fields: {
        items: { types: ['array'], rank: 1, shape: [null], elements: ['integer'] },
        count: { types: ['integer'] },
    } });
    expect(result.bindings.get('X')?.fields?.count.integer).toBeUndefined();
    expect(result.bindings.get('X')?.fields?.items.eagerScalarCells).toBeUndefined();
    expect(messages('fun apply F\n R = record\n .x = 1\n end\n 0 F\n R = record\n .y = 2\n end\n return R\nend\nCallback apply')
        .some(message => message.includes('fields .x') && message.includes('fields .y'))).toBe(true);
});

it('keeps a record schema after control-flow joins and loop invalidation', () => {
    for (const middle of ['if Flag\n R = record\n .items = array 3\n end\nend',
        'for I in 1 to 2\n Unknown\nend']) {
        expect(messages(vector + middle + '\nR = record\n .other = 1\nend')
            .some(message => message.includes('fields .items') && message.includes('fields .other'))).toBe(true);
    }
});
