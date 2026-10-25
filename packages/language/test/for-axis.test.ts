import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { groupExpressions } from '../src/expression-grouping.js';
import { createRankServices } from '../src/rank-module.js';
import { isNameExpression, type Program } from '../src/generated/ast.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function parse(header: string, shape = '2 3') {
    const parsed = parser.parse<Program>(`M = array shape ${shape} fill 1\nfor ${header}\n V\nend\n`);
    expect(parsed.parserErrors).toEqual([]);
    return parsed.value;
}
it.each(['V in M axis 1', 'V j in M axis -1', 'V i j in M axis 0 1', 'V i in M axis 0 1', '# i j in M axis 1 0', 'V # # in M axis 0 1'])(
    'accepts traversal axes and coordinate bindings: %s', header => {
        expect(groupExpressions(parse(header)).diagnostics).toEqual([]);
    });
it.each([
    ['V in M rank 1', 'does not accept rank'], ['V in M axis 1 rank 1', 'does not accept rank'],
    ['V in M axis', 'integer literals'], ['V in M axis 1.5', 'integer literals'], ['V in M axis N', 'integer literals'],
    ['V i j k in M axis 0 1', 'one index name per'],
])('diagnoses malformed loop headers: %s', (header, message) => {
    expect(groupExpressions(parse(header)).diagnostics.some(d => d.message.includes(message))).toBe(true);
});
it.each([['2', 'invalid for rank 2'], ['-3', 'invalid for rank 2'], ['1 -1', 'unique'], ['0 0', 'unique']])(
    'diagnoses invalid axes on empty sources: %s', (axes, message) => {
        expect(analyzeValues(parse(`V in M axis ${axes}`, '0 3')).diagnostics.some(d => d.message.includes(message))).toBe(true);
    });
it.each([['1', 'V j', [2, 4]], ['0 2', 'V i k', [3]], ['2 1 0', 'V i j k', []]] as const)(
    'infers remaining cell shape for axes %s', (axes, names, shape) => {
        const program = parse(`${names} in M axis ${axes}`, '2 3 4');
        const analysis = analyzeValues(program);
        expect(analysis.diagnostics).toEqual([]);
        const values = [...analysis.expressions.entries()].filter(([node]) => isNameExpression(node) && node.name === 'V');
        expect(values.some(([, facts]) => JSON.stringify(facts.shape) === JSON.stringify(shape))).toBe(true);
    });
