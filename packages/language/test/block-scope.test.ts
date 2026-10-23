import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { blockScopeDiagnostics, createRankServices, type Program } from '../src/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function diagnostics(source: string, known: ReadonlySet<string> = new Set()) {
    const parsed = parser.parse<Program>(source);
    expect(parsed.lexerErrors).toEqual([]);
    expect(parsed.parserErrors).toEqual([]);
    return blockScopeDiagnostics(parsed.value, known);
}

describe('block header bindings', () => {
    it.each([
        'I = 99\nfor I in 1 to 3\nend',
        'I = "keep"\nfor I in 1 to 3\nend',
        'I = 99\nfor Value I in array 10 20\nend',
        'fun I total\n for I in 1 to 3\n end\n return I\nend',
        'for I in 1 to 3\n for I in 1 to 2\n end\nend',
        'if true\n I = 99\n for I in 1 to 3\n end\nend',
        'I = 99\nif false\n for I in 1 to 3\n end\nend',
    ])('rejects an iteration or index name already visible outside: %s', source => {
        expect(diagnostics(source).map(item => item.message)).toEqual([
            'I is already bound outside this block; use a different for binding name.',
        ]);
    });

    it.each([
        'Error = 99\ntry\n .Oops raise\ncatch Error\nend',
        'fun Error handle\n try\n  .Oops raise\n catch Error\n end\n return Error\nend',
        'try\n .Oops raise\ncatch Error\n try\n  .Again raise\n catch Error\n end\nend',
    ])('rejects an error name already visible outside: %s', source => {
        const errors = diagnostics(source);
        expect(errors.map(item => item.message)).toEqual([
            'Error is already bound outside this block; use a different catch binding name.',
        ]);
        expect(errors[0].node.$type).toBe('CatchClause');
    });

    it.each([
        ['for I in 1 to 3\nend', 'I', 'for'],
        ['try\n .Oops raise\ncatch Error\nend', 'Error', 'catch'],
    ])('checks workspace names before entering %s', (source, name, kind) => {
        expect(diagnostics(source, new Set([name])).map(item => item.message)).toEqual([
            `${name} is already bound outside this block; use a different ${kind} binding name.`,
        ]);
    });

    it.each([
        'for I in 1 to 3\nend\nfor I in 1 to 2\nend\nI = 99',
        'if true\n I = 99\nend\nfor I in 1 to 3\nend',
        'try\n .Oops raise\ncatch .Oops Error\ncatch Error\nend\ntry\n .Again raise\ncatch Error\nend',
        'I = 99\nfor # in 1 to 3\n I += 1\nend',
        'Total = 0\nfor I in 1 to 3\n Total = Total + I\nend\nif true\n Total += 1\nend',
        'N = 8\nfor N greater 1\n N = N // 2\nend',
    ])('preserves independent blocks and ordinary outer assignments: %s', source => {
        expect(diagnostics(source)).toEqual([]);
    });

    it('explains how to retain a header value without reusing its name', () => {
        expect(diagnostics('for I in 1 to 3\nend\nI')[0].message).toBe(
            'I was assigned inside the block that ends at line 2 and does not exist after it. '
            + 'To keep its value, assign it to a different name declared before the block.',
        );
    });
});
