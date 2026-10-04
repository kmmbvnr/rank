import { expect, it } from 'vitest';
import type { AstNode } from 'langium';
import { RequirementSolver } from '../src/analysis/requirement-solver.js';
import { Graph } from '../src/analysis/requirement-graph.js';
const node = { $type: 'Program' } as AstNode;
const at = (reason: string) => ({ node, reason });
it('propagates offset equalities and retains both conflicting sites', () => {
    const solver = new RequirementSolver();
    const a = solver.variable(), b = solver.variable(), c = solver.variable();
    solver.equal(a, b, at('selector'), 1);
    solver.equal(b, c, at('alias'));
    solver.bound(c, 2, Infinity, at('consumer'));
    solver.bound(a, 1, 1, at('producer'));
    expect(solver.solve().conflicts).toMatchObject([{ first: { reason: 'consumer' }, second: { reason: 'producer' } }]);
});
it('propagates frame and result bounds backward, including negative cell ranks', () => {
    for (const cell of [1, -1]) {
        const solver = new RequirementSolver();
        const input = solver.variable(), frame = solver.variable(), result = solver.variable(), output = solver.variable();
        solver.bound(input, 2, 2, at('input'));
        solver.frame(input, frame, cell, at('rank'));
        solver.sum(output, frame, result, at('assembly'));
        solver.bound(output, 3, Infinity, at('consumer'));
        expect(solver.solve().intervals[result].min).toBe(2);
    }
});
it('copies function constraints without sharing solved call variables', () => {
    const template = new RequirementSolver();
    const param = template.variable();
    template.bound(param, 1, Infinity, at('parameter'));
    const caller = new RequirementSolver(), a = caller.copy(template), b = caller.copy(template);
    caller.bound(a(param), 1, 1, at('first call'));
    caller.bound(b(param), 3, 3, at('second call'));
    expect(caller.solve().conflicts).toEqual([]);
    expect(template.solve().intervals[param]).toMatchObject({ min: 1, max: Infinity });
});
it('bounds editor work on a recursive increasing-rank equation', () => {
    const solver = new RequirementSolver();
    const a = solver.variable(), one = solver.variable();
    solver.bound(one, 1, 1, at('one'));
    solver.sum(a, a, one, at('recursive result'));
    expect(solver.solve().limited).toBe(true);
});
it('checks known argument lengths against dimensions already present in a template', () => {
    const graph = new Graph();
    const parameter = graph.value(node);
    graph.solver.bound(graph.dimension(parameter, 0), 2, 2, at('consumer length'));
    const argument = graph.value(node, { types: ['array'], rank: 1, shape: [3] });
    graph.same(parameter, argument, at('argument'));
    expect(graph.solve().conflicts).toMatchObject([{ kind: 'dimension' }]);
});

it('carries nested field requirements through aliases made before or after selection', () => {
    for (const early of [false, true]) {
        const graph = new Graph(), input = graph.value(node), alias = graph.value(node);
        if (early) graph.same(input, alias, at('alias'));
        const items = graph.field(graph.field(alias, 'payload', node), 'items', node);
        graph.solver.bound(items.rank, 2, 2, at('matrix consumer'));
        graph.domains.push({ variable: items.domain, types: ['integer'], site: at('integer consumer') });
        if (!early) graph.same(input, alias, at('alias'));
        expect(graph.solve().read(input).fields?.get('payload')?.fields?.get('items'))
            .toMatchObject({ rank: { min: 2, max: 2 }, domains: ['integer'] });
        expect(input.fact.types).toEqual([]);
        expect(input.fact.fields).toBeUndefined();
    }
});

it('combines independent consumers of a field and preserves both conflicting sites', () => {
    const graph = new Graph(), first = graph.value(node), second = graph.value(node);
    const a = graph.field(first, 'price', node), b = graph.field(second, 'price', node);
    graph.solver.bound(a.rank, 0, 0, at('scalar consumer'));
    graph.solver.bound(b.rank, 1, 1, at('column consumer'));
    graph.same(first, second, at('same input'));
    const conflicts = graph.solve().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('rank');
    expect(new Set([conflicts[0].first.reason, conflicts[0].second.reason]))
        .toEqual(new Set(['scalar consumer', 'column consumer']));
});

it('instantiates field projections independently and carries downstream requirements to parameters', () => {
    const template = new Graph(), parameter = template.value(node);
    const result = template.field(parameter, 'items', node);
    const caller = new Graph();
    const first = caller.instantiate({ graph: template, params: [parameter], result });
    const second = caller.instantiate({ graph: template, params: [parameter], result });
    caller.solver.bound(first.result.rank, 1, 1, at('first consumer'));
    caller.solver.bound(second.result.rank, 2, 2, at('second consumer'));
    const solved = caller.solve();
    expect(solved.conflicts).toEqual([]);
    expect(solved.read(first.params[0]).fields?.get('items')?.rank).toMatchObject({ min: 1, max: 1 });
    expect(solved.read(second.params[0]).fields?.get('items')?.rank).toMatchObject({ min: 2, max: 2 });
    expect(template.solve().read(parameter).fields?.get('items')?.rank).toMatchObject({ min: 0, max: Infinity });
});

it('keeps field selections added after an identity template reaches its caller', () => {
    const template = new Graph(), parameter = template.value(node), result = template.value(node);
    template.same(parameter, result, at('identity'));
    const caller = new Graph(), instance = caller.instantiate({ graph: template, params: [parameter], result });
    const output = caller.field(instance.result, 'rows', node);
    caller.solver.bound(caller.dimension(output, 0), 3, 3, at('three rows'));
    expect(caller.solve().read(instance.params[0]).fields?.get('rows')?.dimensions.get(0))
        .toMatchObject({ min: 3, max: 3 });
});

it('bounds cyclic field requirements without turning them into proven facts', () => {
    const template = new Graph(), input = template.value(node);
    template.same(input, template.field(input, 'self', node), at('cycle'));
    const caller = new Graph(), instance = caller.instantiate({ graph: template, params: [input], result: input });
    const solved = caller.solve();
    expect(solved.read(instance.result).fields?.get('self')?.fields).toBeUndefined();
    expect(solved.limited).toBe(true);
    expect(instance.result.fact.types).toEqual([]);
});
