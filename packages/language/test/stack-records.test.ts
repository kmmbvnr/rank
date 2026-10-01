import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { UNKNOWN_VALUE, type ValueFacts } from '../src/analysis/value-domain.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
function result(body: string, inputs: ValueFacts[] = [integer]) {
    const parsed = parser.parse<Program>(`fun f N\n${body}\nend\n`);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value, new Map(), new Map(), [{ name: 'f', arguments: inputs }]);
    expect(analysis.diagnostics).toEqual([]);
    return analysis.functionResults[0];
}
const record = (path: string, extra = '') => `record\n .path = ${path}\n${extra}end`;

describe('record fields through mutable stacks', () => {
    it('keeps the integer field across insertion, peek, alias writes and removal', () => {
        expect(result(` S = new stack\n S push ${record('1')}\n Top = S peek\n Top .path = N + 1\n`
            + ' Lower = S pop\n return Lower .path')).toMatchObject({ types: ['integer'], rank: 0 });
    });

    it('follows aliases of the stack and of its records', () => {
        expect(result(` S = new stack\n Alias = S\n Alias push ${record('1')}\n Top = S peek\n Same = Top\n`
            + ' Same .path += 1\n return Top .path')).toMatchObject({ types: ['integer'] });
    });

    it('joins field types across insertions and keeps the cells that were removed', () => {
        const body = (second: string) => ` S = new stack\n S push ${record('1')}\n Gone = S pop\n S push ${record(second)}\n`
            + ' Top = S peek\n return Top .path';
        expect(result(body('2')).types).toEqual(['integer']);
        expect(result(body('"text"')).types).toEqual(['integer', 'text']);
    });

    it('claims nothing for an empty stack or for fields that insertions do not share', () => {
        expect(result(' S = new stack\n Top = S peek\n return Top .path').types).toEqual([]);
        expect(result(` S = new stack\n S push ${record('1')}\n S push record\n .other = 2\n end\n`
            + ' Top = S peek\n return Top .path').types).toEqual([]);
    });

    it('does not manufacture a schema from an unknown insertion', () => {
        expect(result(` S = new stack\n S push ${record('1')}\n S push Unknown\n Top = S peek\n return Top .path`,
            [integer]).types).toEqual([]);
        expect(result(` S = new stack\n S push ${record('1')}\n S push R\n Top = S peek\n return Top .path`,
            [UNKNOWN_VALUE]).types).toEqual([]);
        // The record of an unknown schema still has no fields to read.
        expect(result(' S = new stack\n S push R\n Top = S peek\n return Top .path', [{ types: ['record'] }]).types)
            .toEqual([]);
    });

    it('does not carry a schema into a later iteration that inserts another one', () => {
        const types = result(` S = new stack\n S push ${record('1')}\n for Index in 0 till N\n`
            + `  Top = S peek\n  Last = Top .path\n  S push ${record('1.5')}\n end\n return Last`).types;
        expect(types).not.toEqual(['integer']);
    });
});

describe('record fields through nested calls that mutate a captured stack', () => {
    const outer = (helper: string, tail = ' Top = S pop\n return Top .path') =>
        ` S = new stack\n fun add X\n${helper}\n return 0\n end\n for I in 0 till N\n  I add\n end\n${tail}`;

    it('summarizes insertions, removals and field writes of the callee', () => {
        const helper = `  Current = ${record('X')}\n  if S len equal 0\n   S push Current\n   return 0\n  end\n`
            + '  Top = S peek\n  Top .path = Top .path + X\n  S push Current';
        expect(result(outer(helper))).toMatchObject({ types: ['integer'], rank: 0 });
    });

    it('keeps the union of every record schema the callee may insert', () => {
        const helper = `  S push ${record('X')}\n  S push ${record('1.5')}`;
        expect(result(outer(helper)).types).toEqual(['integer', 'real']);
        const different = `  S push ${record('X')}\n  S push record\n   .other = 1\n  end`;
        expect(result(outer(different)).types).toEqual([]);
    });

    it('does not summarize a callee with an unknown effect', () => {
        expect(result(outer(`  S push ${record('X')}\n  Unknown external`)).types).toEqual([]);
        expect(result(outer(`  S push ${record('X')}\n  S push R`, '  Top = S pop\n  return Top .path'), [integer]).types)
            .toEqual([]);
    });

    it('treats a callee that reads an empty stack as unknown', () => {
        expect(result(outer('  Top = S peek\n  Top .path = X', ' Top = S peek\n return Top .path')).types).toEqual([]);
    });
});
