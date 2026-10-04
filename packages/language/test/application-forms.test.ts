import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { axisLengthForm, axisReductionForm, sortDirectionForm,
    symbolicApplicationForm, applicationForm } from '../src/application-forms.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { flattenApplication } from '../src/expressions.js';
import { findOperation } from '../src/operations.js';
import { createRankServices } from '../src/rank-module.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;

it.each([
    ['A len axis 1', 'axis-length'], ['A sum axis 1', 'axis-reduction'],
    ['A argsort axis 1', 'axis-argsort'], ['A shuffle axis 1', 'axis-shuffle'],
    ['A 0.5 quantile axis 1', 'axis-quantile'], ['A B mse axis 1', 'axis-metric'],
    ['A transpose axis 1 0', 'axis-transpose'], ['A B matmul axis 1 0', 'axis-matmul'],
    ['A covariance axis 0 1', 'axis-covariance'], ['A corr axis 0 1', 'axis-correlation'],
    ['A sum rank 1', 'rank'], ['A axis 1 0', 'axis-selection'],
    ['A 2 window axis 0', 'axis-window'], ['A 1 shift with 9', 'axis-shift'],
    ['A 1 shift with 9 axis 1', 'axis-shift'], ['A 1 shift axis 1', 'axis-shift'], ['A 1 shift', 'plain'], ['A 2 window padding 1 with 9', 'axis-window'],
    ['A 2 window stride 2 padding 1 with 9 axis 1', 'axis-window'], ['A B equal rank 1', 'comparison-rank'],
    ['A scan min with 0', 'named-scan'], ['A segment min', 'named-segment'],
    ['A B outer min', 'named-outer'], ['A sort .descending', 'sort-direction'],
    ['A findroot 1', 'dsu-method'],
    ['A jump 1 2', 'functional-method'], ['A floor 2', 'multiset-method'],
    ['A edges 1', 'graph-edges'], ['A array len', 'materialize-pipeline'],
    ['A scan + with 0', 'scan'], ['A scan + axis 1', 'scan'], ['A scan min axis 0', 'named-scan'], ['A reduce +', 'reduce'], ['A segment +', 'segment'],
    ['A B outer +', 'outer'], ['1 + 2', 'plain'],
])('classifies %s as %s', (source, kind) => {
    const parsed = parser.parse<Program>(`Result = ${source}\n`);
    expect(parsed.parserErrors.map(error => error.message)).toEqual([]);
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    expect(applicationForm(statement.value).kind).toBe(kind);
});

it('uses operation identity for aliases and does not confuse a user function with a builtin', () => {
    const parsed = parser.parse<Program>('Result = A B Op axis 1 0\n');
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    expect(applicationForm(statement.value, name => name === 'Op' ? findOperation('matmul') : findOperation(name)))
        .toMatchObject({ kind: 'axis-matmul', axes: [1, 0] });
    expect(applicationForm(statement.value, name => name === 'Op' ? false : findOperation(name)).kind).toBe('plain');
});

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

it('keeps the axis-length syntax separate from its runtime axis check', () => {
    const parsed = parser.parse<Program>('Result = Values len axis 2\n');
    expect(parsed.parserErrors).toEqual([]);
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    const parts = flattenApplication(statement.value);
    expect(axisLengthForm(parts)?.kind).toBe('axis-length');
    expect(axisLengthForm(parts, name => name !== 'len')).toBeUndefined();
});

it('recognizes symbolic modifiers once and respects a shadowed modifier', () => {
    const symbolic = (source: string, standard: (name: string) => boolean = () => true) => {
        const parsed = parser.parse<Program>(`Result = ${source}\n`);
        expect(parsed.parserErrors).toEqual([]);
        const statement = parsed.value.statements[0];
        if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
        return symbolicApplicationForm(statement.value, standard);
    };
    expect(symbolic('Values scan + with 0')?.kind).toBe('scan');
    expect(symbolic('Values reduce + rank 1 with 0')?.kind).toBe('reduce');
    expect(symbolic('Values segment +')?.kind).toBe('segment');
    expect(symbolic('A B outer *')?.kind).toBe('outer');
    expect(symbolic('Values scan + axis 1')?.kind).toBe('scan');
    expect(symbolic('Values scan + axis 1')).toMatchObject({ axis: { value: 1n } });
    expect(symbolic('Values scan +', name => name !== 'scan')).toBeUndefined();
});

it.each([
    ['Path csv check', 'csv'], ['(Path csv) check', 'csv'],
    ['Text json check', 'json'], ['Text json .flat check', 'json'], ['Text .flat json check', 'json'],
    ['Text xml check', 'xml'], ['Text xml .flat check', 'xml'], ['Text .flat xml check', 'xml'],
])('recognizes %s as a checked reader', (source, reader) => {
    const parsed = parser.parse<Program>(`Result = ${source}`);
    expect(parsed.parserErrors).toEqual([]);
    const assignment = parsed.value.statements[0];
    expect(isAssignmentStatement(assignment)).toBe(true);
    if (!isAssignmentStatement(assignment)) return;
    expect(applicationForm(assignment.value)).toMatchObject({ kind: 'checked-read', reader });
    expect(applicationForm(assignment.value, name => name === 'check' || name === reader ? false : findOperation(name)))
        .toMatchObject({ kind: 'plain' });
});

it('does not interpret a CSV write as a checked read', () => {
    const parsed = parser.parse<Program>('Result = Rows Path csv check');
    expect(parsed.parserErrors).toEqual([]);
    const assignment = parsed.value.statements[0];
    if (!isAssignmentStatement(assignment)) throw new Error('expected assignment');
    expect(applicationForm(assignment.value)).toMatchObject({ kind: 'invalid' });
});
