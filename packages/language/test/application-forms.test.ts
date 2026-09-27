import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { axisReductionForm, sortDirectionForm } from '../src/application-forms.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { flattenApplication } from '../src/expressions.js';
import { findOperation } from '../src/operations.js';
import { createRankServices } from '../src/rank-module.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;

function form(source: string, standard: (name: string) => boolean = () => true) {
    const parsed = parser.parse<Program>(`Result = ${source}\n`);
    expect(parsed.parserErrors).toEqual([]);
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    return axisReductionForm(flattenApplication(statement.value), standard);
}

it('recognizes axis reductions by catalogue identity and retains source and axes', () => {
    const reduction = form('Values mean axis 0 2');
    expect(reduction?.kind).toBe('axis-reduction');
    expect(reduction?.operation).toBe(findOperation('mean'));
    expect(reduction?.axes).toHaveLength(2);
    expect(reduction?.operation.module).toBe('stats');
    expect(form('Values mean axis 0 2', name => name !== 'mean')).toBeUndefined();
    expect(form('Values argsort axis 0')).toBeUndefined();
});

it('recognizes a directed sort through the operation catalogue and binding identity', () => {
    const parsed = parser.parse<Program>('Result = Values sort .descending\n');
    expect(parsed.parserErrors).toEqual([]);
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    const parts = flattenApplication(statement.value);
    expect(sortDirectionForm(parts)?.operation).toBe(findOperation('sort'));
    expect(sortDirectionForm(parts, name => name !== 'sort')).toBeUndefined();
    expect(sortDirectionForm(parts.slice(0, -1))).toBeUndefined();
});
