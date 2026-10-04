import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { inferRequirements } from '../src/analysis/requirements.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function parse(source: string): Program {
    const parsed = parser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    return parsed.value;
}
const infer = (source: string) => inferRequirements(parse(source));
const binding = (source: string, name: string) => infer(source).bindings.find(item => item.name === name)!;
it('infers selectors on an unknown producer without manufacturing a forward fact', () => {
    const program = parse('Rows = Data decode\nRows # 2');
    expect(inferRequirements(program).bindings[0].rank.min).toBe(2);
    expect(analyzeValues(program).bindings.get('Rows')?.rank).toBeUndefined();
});
it('summarizes uncalled parameters and checks independent polymorphic calls', () => {
    const source = 'fun spread M\n return M # 1 max - M # 1 min\nend\n';
    const program = parse(source);
    const definition = program.statements.find(isFunctionStatement)!;
    expect(inferRequirements(program).functions.get(definition)?.params[0].rank.min).toBe(2);
    expect(infer(source + 'A = array 1 2\nA spread').conflicts.length).toBeGreaterThan(0);
    expect(infer('fun identity X\n return X\nend\nA = 1 identity\nB = (array 1 2) identity').conflicts).toEqual([]);
});
it('carries a downstream requirement through a function result to its argument', () => {
    const source = 'fun identity X\n return X\nend\nA = Input decode\nB = A identity\nB # 0';
    expect(binding(source, 'A').rank.min).toBe(2);
    expect(binding(source, 'B').rank.min).toBe(2);
});
it('does not impose a lower bound for clamped or negative ordinary ranks', () => {
    expect(infer('A = array 1 2\nA sum rank 5').conflicts).toEqual([]);
    expect(infer('A = array 1 2\nA sum rank -1').conflicts).toEqual([]);
    expect(binding('A = Input decode\nA + reduce rank 3', 'A').rank.min).toBe(3);
    expect(binding('A = Input decode\nA sum axis 0 rank 2', 'A').rank).toMatchObject({ min: 3, max: 3 });
});
it('propagates lifted-result requirements without merging separate calls', () => {
    const source = 'fun parse X\n return X decode\nend\nData = array shape 3 4 fill 1\nRows = Data parse rank 1\nRows # 2';
    expect(binding(source, 'Rows').rank.min).toBe(2);
    expect(infer(source).conflicts).toEqual([]);
});
it('preserves binding ranks while allowing axis lengths to change on reassignment', () => {
    expect(infer('A = array 1 2\nA = array 1 2 3').conflicts).toEqual([]);
    expect(infer('A = array 1 2\nA = array shape 2 2 fill 0').conflicts.length).toBeGreaterThan(0);
});
it('does not confuse globals, parameters, nested functions or captured writes', () => {
    expect(infer('M = 1\nfun spread M\n return M # 1\nend').conflicts).toEqual([]);
    expect(infer('fun outer X\n fun inner M\n  return M # 1\n end\n return X inner\nend\n(array 1 2) outer').conflicts.length).toBeGreaterThan(0);
    expect(infer('fun outer\n M = array 1 2\n fun change\n  M = array shape 2 2 fill 0\n end\n change\n return M # 1\nend').conflicts).toEqual([]);
});
it('keeps guarded uses and zero-trip loops from constraining all calls', () => {
    expect(infer('fun pick X\n if X is .array\n  return X # 1\n end\n return X\nend\n1 pick').conflicts).toEqual([]);
    expect(infer('fun pick X\n for I in 0 till 0\n  X # 1\n end\n return X\nend\n1 pick').conflicts).toEqual([]);
});
it('does not assign requirements to an unknown callback parameter', () => {
    const program = parse('fun apply X Callback\n return X Callback\nend');
    const definition = program.statements.find(isFunctionStatement)!;
    expect(inferRequirements(program).functions.get(definition)?.params.map(param => [param.rank.min, param.rank.max]))
        .toEqual([[0, Infinity], [0, Infinity]]);
});
it('instantiates imported summaries at each call', () => {
    const module = parse('fun spread M\n return M # 1\nend');
    const program = parse('use "matrix" as matrix\n(array 1 2) matrix.spread');
    expect(inferRequirements(program, { loadModule: () => module }).conflicts.length).toBeGreaterThan(0);
});
describe('dimension and domain requirements', () => {
    it('collects exact square dimensions but never equates broadcast operands', () => {
        expect(infer('use linalg\nA = array shape 2 3 fill 1\nA det').conflicts.some(item => item.kind === 'dimension')).toBe(true);
        expect(infer('A = array shape 2 3 fill 1\nB = array shape 1 3 fill 2\nA + B').conflicts).toEqual([]);
    });
    it('gets accepted domains from the catalogue and reports two sites', () => {
        const result = infer('use text\nX = stdin .word\nX lower\nX / 2');
        const conflict = result.conflicts.find(item => item.kind === 'domain');
        expect(conflict).toBeDefined();
        expect(conflict?.first.node).not.toBe(conflict?.second.node);
    });
    it('allows an empty array to satisfy disjoint cell-domain uses', () => {
        expect(infer('use text\nX = array shape 0 fill .NA\nX lower\nX sum').conflicts).toEqual([]);
    });
});

it('reuses symbolic lengths and propagates exact square requirements across values', () => {
    const source = 'use linalg\nN = stdin .integer\nA = array shape N 2 fill 1\nB = array shape N 3 fill 1\nA det\nB det';
    expect(infer(source).conflicts.some(conflict => conflict.kind === 'dimension')).toBe(true);
    const consistent = source.replace('N 3', 'N 2');
    expect(infer(consistent).conflicts).toEqual([]);
});
it('carries dimensions through identity calls without mixing specializations', () => {
    const source = 'use linalg\nfun identity X\n return X\nend\nN = stdin .integer\nA = array shape N 2 fill 1\nB = A identity\nB det';
    expect(binding(source, 'A').dimensions.get(0)).toMatchObject({ min: 2, max: 2 });
    expect(infer(source + '\nC = (array shape 3 3 fill 1) identity\nC det').conflicts).toEqual([]);
});
it('keeps missing seeds and typed text atoms out of tensor-only rank rules', () => {
    expect(infer('X = .NA\nX = array 1 2').conflicts).toEqual([]);
    expect(infer('X = "ab"\nX min').conflicts).toEqual([]);
    expect(infer('X = .NA\nX / 2').conflicts).toEqual([]);
});
it('does not reuse a later return when an earlier conditional may return another shape', () => {
    expect(infer('fun decide X\n if X equal 0\n  return array shape 2 2 fill 1\n end\n return X\nend\nA = 0 decide\nA # 1').conflicts).toEqual([]);
});
it('formats both source sites within forty columns', async () => {
    const { requirementMessage } = await import('../src/analysis/requirement-diagnostics.js');
    const conflicts = infer('A = Input decode\nA # 0\nA = 1').conflicts;
    expect(conflicts).toHaveLength(1);
    const message = requirementMessage(conflicts[0]);
    expect(message).toContain('line 2:');
    expect(message).toContain('line 3:');
    expect(message.split('\n').every(line => line.length <= 40)).toBe(true);
    expect(analyzeValues(parse('A = Input decode\nA # 0\nA = 1')).diagnostics.some(item => item.code === 'RequirementConflict')).toBe(true);
});

it('reuses one imported template under multiple aliases and terminates cyclic imports', () => {
    const module = parse('use "self" as self\nfun spread M\n return M # 0\nend');
    const source = parse('use "self" as first\nuse "self" as second\n(array 1 2) second.spread');
    expect(inferRequirements(source, { loadModule: () => module }).conflicts.length).toBeGreaterThan(0);
});
it('keeps requirement templates bounded when definitions duplicate calls', () => {
    const sources = ['fun f0 X\n return X # 0\nend'];
    for (let i = 1; i < 20; i++) sources.push(`fun f${i} X\n A = X f${i - 1}\n B = X f${i - 1}\n return A\nend`);
    expect(infer(sources.join('\n')).limited).toBe(true);
});

it('does not guess that an unresolved source import refers to a builtin', () => {
    expect(infer('use "unknown"\nA = array 1 2\nA 25 solve').conflicts).toEqual([]);
});
it('keeps completed unary pipelines separate from binary builtin operands', () => {
    expect(infer('use text\nuse sequences\n2969 text sort equal 6299 text sort').conflicts).toEqual([]);
});

it('preserves unresolved import boundaries inside function templates', () => {
    expect(infer('use "unknown"\nfun f X\n return X 25 solve\nend\n(array 1 2) f').conflicts).toEqual([]);
});

it('attaches a selected CSV column requirement to the original value through an alias', () => {
    const source = 'use tables\nRows = "data.csv" csv\nAlias = Rows\nAlias .price sum';
    const requirements = infer(source);
    expect(requirements.bindings.find(item => item.name === 'Rows')?.fields?.get('price')?.domains)
        .toEqual(['integer', 'real', 'missing']);
    expect(requirements.bindings.find(item => item.name === 'Alias')?.fields?.get('price')?.domains)
        .toEqual(['integer', 'real', 'missing']);
    expect(analyzeValues(parse(source)).bindings.get('Rows')?.fields).toBeUndefined();
});

it('does not attach a guarded or unresolved callback selection to an external input', () => {
    const guarded = 'use tables\nRows = "data.csv" csv\nif Flag\n Rows .price sum\nend';
    expect(binding(guarded, 'Rows').fields).toBeUndefined();
    const unknown = 'Rows = Input decode\nRows .price sum';
    expect(binding(unknown, 'Rows').fields).toBeUndefined();
});

it('keeps field requirements tied to the selected value across reassignment', () => {
    const source = 'use tables\nRows = "first.csv" csv\nAlias = Rows\nRows = "second.csv" csv\nAlias .price sum';
    const reads = infer(source).bindings.filter(item => item.name === 'Rows');
    expect(reads[0].fields?.get('price')?.domains).toEqual(['integer', 'real', 'missing']);
    expect(reads[1].fields).toBeUndefined();
});

it('still discards structural requirements across an unresolved callback', () => {
    const source = 'use tables\nRows = "data.csv" csv\nRows mutate\nRows .price sum';
    expect(binding(source, 'Rows').fields).toBeUndefined();
});

it('retains independent checked-read contracts for the callers of a reader function', () => {
    const source = 'use tables\nuse text\nfun load Path\n return Path csv check\nend\nA = "first.csv" load\nA .price sum\nB = "second.csv" load\nB .name lower';
    const program = parse(source);
    const answer = inferRequirements(program, { includeCalls: true });
    const calls = [...answer.calls.values()];
    expect(calls).toHaveLength(2);
    const checked = (call: typeof calls[number]) => [...call.expressions].find(([node]) =>
        node.$cstNode?.text === 'Path csv check')?.[1];
    expect(checked(calls[0])?.fields?.get('price')?.domains).toEqual(['integer', 'real', 'missing']);
    expect(checked(calls[0])?.fields?.has('name')).toBe(false);
    expect(checked(calls[1])?.fields?.get('name')?.domains).toEqual(['text']);
    expect(checked(calls[1])?.fields?.has('price')).toBe(false);
    expect(inferRequirements(program).calls.size).toBe(0);
});

it('carries caller requirements to a checked read through a nested wrapper', () => {
    const source = 'use tables\nfun readrows Path\n return Path csv check\nend\nfun load Path\n return Path readrows\nend\nRows = "data.csv" load\nRows .price sum';
    const answer = inferRequirements(parse(source), { includeCalls: true });
    const wrapper = [...answer.calls.values()][0];
    expect(wrapper.name).toBe('load');
    const reader = [...wrapper.calls.values()][0];
    expect(reader.name).toBe('readrows');
    const checked = [...reader.expressions].find(([node]) => node.$cstNode?.text === 'Path csv check')?.[1];
    expect(checked?.fields?.get('price')?.domains).toEqual(['integer', 'real', 'missing']);
});

it('links checked CSV row lengths when a later dot product needs equal columns', () => {
    const source = 'use tables\nuse linalg\nA = "a.csv" csv check\nB = "b.csv" csv check\nX = A .value\nY = B .value\nX Y matmul';
    const answer = infer(source);
    const a = answer.bindings.find(item => item.name === 'A')!;
    const b = answer.bindings.find(item => item.name === 'B')!;
    expect(answer.conflicts).toEqual([]);
    expect(a.dimensions.get(0)?.equality).toEqual(b.dimensions.get(0)?.equality);
    expect(a.fields?.get('value')?.dimensions.get(0)?.equality).toEqual(a.dimensions.get(0)?.equality);
    expect(b.fields?.get('value')?.domains).toEqual(['integer', 'real']);
});
