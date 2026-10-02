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
