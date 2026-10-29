import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { expect, it } from 'vitest';
import { createRankServices, type Program } from '../src/index.js';

const parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);
it.each(['+=', '-=', '*='])('parses and validates %s accumulation independently of the RHS', async operator => {
    const document = await parse(`use sequences\nA = array 1 2\nA (array 0 0) ${operator} (1 + 2) * 3 .accumulate`, { validation: true });
    expect(document.parseResult.lexerErrors).toEqual([]);
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.diagnostics).toEqual([]);
    expect(document.parseResult.value.statements.at(-1)).toMatchObject({
        $type: 'ArrayAssignmentStatement', accumulate: true, operator,
        value: { $type: 'BinaryExpression', operator: '*' },
    });
});
it.each(['=', '/=', '//=', '**=', 'mod=', 'and=', 'or=', 'xor='])('rejects %s accumulation during validation', async operator => {
    const document = await parse(`A = array 1 2\nA (array 0 0) ${operator} 2 .accumulate`, { validation: true });
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.diagnostics?.some(d => /accumulate supports only/.test(String(d.message)))).toBe(true);
});
it.each(['N += 1 .accumulate', 'file "x" = "y" .accumulate'])('rejects accumulation outside indexed array writes: %s', async source => {
    const document = await parse('N = 1\n' + source, { validation: true });
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.diagnostics?.some(d => /accumulate requires indexed/.test(String(d.message)))).toBe(true);
});

it.each(['.accumulate', '.accumulated'])('preserves %s as label data', async label => {
    const document = await parse(`Label = ${label}\nA = array 1\nA 0 = (${label})`, { validation: true });
    expect(document.parseResult.lexerErrors).toEqual([]);
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.parseResult.value.statements[0]).toMatchObject({ value: { $type: 'LabelLiteral', name: label.slice(1) } });
    expect(document.parseResult.value.statements.at(-1)).toMatchObject({ accumulate: false });
});
it('recognizes the mode after a multiline RHS and before a comment', async () => {
    const document = await parse('A = array 1\nA (array 0 0) += (\n  1 + 2\n) .accumulate rem sum both updates', { validation: true });
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.diagnostics).toEqual([]);
    expect(document.parseResult.value.statements.at(-1)).toMatchObject({ accumulate: true });
});

it.each(['array 2 3', 'array 2 3 shape 2', 'array shape 2 fill 3'])('extracts accumulation after inline weights: %s', async weights => {
    const document = await parse(`A = array 1 2\nA (array 0 0) += ${weights} .accumulate`, { validation: true });
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.diagnostics).toEqual([]);
    expect(document.parseResult.value.statements.at(-1)).toMatchObject({ accumulate: true,
        value: { $type: 'ArrayExpression' } });
});
it('preserves a parenthesized accumulation label inside an inline array', async () => {
    const document = await parse('A = array .first\nA 0 = array .first (.accumulate)', { validation: true });
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.parseResult.value.statements.at(-1)).toMatchObject({ accumulate: false,
        value: { items: [{ value: { name: 'first' } }, { value: { $type: 'ParenthesizedExpression' } }] } });
});

it('does not extract a label from the dimensions of a multiline array', async () => {
    const document = await parse('A = array 1\nA 0 += array shape 1 .accumulate\n  2\nend');
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.parseResult.value.statements.at(-1)).toMatchObject({ accumulate: false });
});
