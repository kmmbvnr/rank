import { analyzeBindings, analyzeValues } from '../src/index.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { expect, it } from 'vitest';
import { axisLengthForm, axisReductionForm, sortDirectionForm,
    symbolicApplicationForm, applicationForm } from '../src/application-forms.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { flattenApplication } from '../src/expressions.js';
import { findOperation } from '../src/operations.js';
import { createRankServices } from '../src/rank-module.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;

it.each([
    ['A diag .anti', 'diagonal'], ['A diag -1', 'diagonal'],
    ['A diag .anti K rank 2', 'diagonal'], ['A diag .anti 1 axis 0 rank 2', 'diagonal'],
    ['A len axis 1', 'axis-length'], ['A sum axis 1', 'axis-reduction'],
    ['A argsort axis 1', 'axis-argsort'], ['A shuffle axis 1', 'axis-shuffle'],
    ['A 0.5 quantile axis 1', 'axis-quantile'], ['A B mse axis 1', 'axis-metric'],
    ['A transpose axis 1 0', 'axis-transpose'], ['A B matmul axis 1 0', 'axis-matmul'],
    ['A covariance axis 0 1', 'axis-covariance'], ['A corr axis 0 1', 'axis-correlation'],
    ['A sum rank 1', 'rank'], ['A axis 1 0', 'axis-selection'],
    ['A window 2 3', 'window'], ['A window unpack Sizes', 'window'],
    ['A window 2 3 shape', 'plain'], ['A window 2 3 axis 0 1 shape', 'plain'],
    ['A window 2 axis 0', 'window'], ['A 1 shift with 9', 'axis-shift'],
    ['A 1 shift with 9 axis 1', 'axis-shift'], ['A 1 shift axis 1', 'axis-shift'], ['A 1 shift', 'plain'], ['A window 2 padding 1 with 9', 'window'],
    ['A window 2 stride 2 padding 1 with 9 axis 1', 'window'], ['A B equal rank 1', 'comparison-rank'],
    ['A next repeat 3', 'repeat'],
    ['A scan min with 0', 'named-scan'], ['A segment min', 'named-segment'],
    ['A reduce min with 0', 'named-reduce'], ['A reduce min', 'named-reduce'],
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

it('returns the original nodes of a pipeline after a user function call', () => {
    const parsed = parser.parse<Program>('Result = 6 upto array len\n');
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    const form = applicationForm(statement.value, name => name === 'upto' ? false : findOperation(name));
    if (form.kind !== 'materialize-pipeline') throw new Error('expected materialize-pipeline');
    expect(form.source).toEqual(flattenApplication(statement.value).slice(0, 2));
    expect(form.source[1]).toBe(flattenApplication(statement.value)[1]);
    expect(form.steps).toEqual(form.selector.items);
    form.steps.forEach((step, index) => expect(step).toBe(form.selector.items[index]));
});

it.each(['1 to Lim', 'array Lim Lim'])('validates a pipeline after a user function returning %s', async body => {
    const parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);
    const messages = async (pipeline: string) => {
        const source = `use sequences\nfun Lim upto\n return ${body}\nend\nX = ${pipeline}\n`;
        const document = await parse(source, { validation: true });
        return (document.diagnostics ?? []).map(diagnostic => diagnostic.message);
    };
    expect(await messages('6 upto array len')).toEqual(await messages('(6 upto) array len'));
});

it.each([
    ['6 upto window 3', 'window'],
    ['3 sq diag .anti', 'diagonal'],
    ['3 sq diag 0', 'diagonal'],
    ['3 sq diag .anti 0 rank 2', 'diagonal'],
])('retains original operands in the synthesized source of %s', (source, kind) => {
    const statement = parser.parse<Program>(`Result = ${source}`).value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    const parts = flattenApplication(statement.value);
    const form = applicationForm(statement.value, name => ['upto', 'sq'].includes(name) ? false : findOperation(name));
    expect(form.kind).toBe(kind);
    if (form.kind !== 'window' && form.kind !== 'diagonal') throw new Error('expected source form');
    flattenApplication(form.source).forEach((part, index) => expect(part).toBe(parts[index]));
    expect(parts[1]).toMatchObject({ name: source.includes('upto') ? 'upto' : 'sq' });
});

it('resolves each classification independently without mutating a reused AST', () => {
    const statement = parser.parse<Program>('Result = A Op 3').value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    const lookup = (name: string) => name === 'Op' ? findOperation('window') : findOperation(name);
    expect(applicationForm(statement.value, lookup).kind).toBe('window');
    expect(applicationForm(statement.value, name => name === 'Op' ? false : findOperation(name)).kind).toBe('plain');
    expect(applicationForm(statement.value, lookup).kind).toBe('window');
    expect(flattenApplication(statement.value)[1]).toMatchObject({ name: 'Op' });
});

it('keeps shadowed window groups as pipeline operands', () => {
    const statement = parser.parse<Program>('Result = A window 2 stride 1').value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    const parts = flattenApplication(statement.value);
    expect(applicationForm(statement.value)).toMatchObject({ kind: 'window', stride: parts[4], rest: [] });
    expect(applicationForm(statement.value, name => name === 'stride' ? false : findOperation(name)))
        .toMatchObject({ kind: 'window', stride: undefined, rest: parts.slice(3) });
});

it.each(['i', 'j', 'k'])('retains implicit %s as a window dimension', name => {
    const statement = parser.parse<Program>(`Result = A window ${name}`).value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    expect(applicationForm(statement.value, key => key === name ? false : findOperation(key)))
        .toMatchObject({ kind: 'window', dimensions: [{ name }], rest: [] });
});


it.each([
    ['6 upto', 'window 3'],
    ['3 sq', 'diag .anti'],
    ['3 sq', 'diag 0'],
])('checks %s %s through value, binding and editor analysis', async (source, suffix) => {
    const prefix = `use sequences
use linalg
fun N upto
 return 1 to N array
end

fun N sq
 return array 1 2 3 4 5 6 7 8 9 shape N N
end

`;
    const analyze = (call: string) => {
        const parsed = parser.parse<Program>(`${prefix}Result = ${call} ${suffix}\n`);
        expect(parsed.parserErrors).toEqual([]);
        const values = analyzeValues(parsed.value);
        const bindings = analyzeBindings(parsed.value);
        expect(values.diagnostics).toEqual([]);
        expect(bindings.words.some(word => word.name.startsWith('\0'))).toBe(false);
        return {
            value: values.bindings.get('Result'),
            binding: bindings.scopes.find(scope => scope.kind === 'program')?.bindings.find(binding => binding.name === 'Result')?.types,
        };
    };
    expect(analyze(source)).toEqual(analyze(`(${source})`));
    const parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);
    const direct = await parse(`${prefix}Result = ${source} ${suffix}\n`, { validation: true });
    const grouped = await parse(`${prefix}Result = (${source}) ${suffix}\n`, { validation: true });
    expect(direct.diagnostics?.map(diagnostic => diagnostic.message))
        .toEqual(grouped.diagnostics?.map(diagnostic => diagnostic.message));
});
