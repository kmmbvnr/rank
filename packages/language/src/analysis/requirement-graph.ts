import { contractElements } from './array-binding-contract.js';
import type { AstNode } from 'langium';
import type { Expression } from '../generated/ast.js';
import { UNKNOWN_VALUE, withPathDims, type ValueFacts } from './value-domain.js';
import type { Dim } from './shape-index.js';
import { RequirementSolver, type RequirementInterval, type RequirementSite } from './requirement-solver.js';

export interface ValueRequirement {
    readonly rank: RequirementInterval;
    /** Required scalar/cell domains. Absent means unconstrained. */
    readonly domains?: readonly string[];
    readonly dimensions: ReadonlyMap<number, RequirementInterval>;
    /** Requirements on named selections, not proof that those fields exist.
     * A table selection describes the projected column, not one row's cell. */
    readonly fields?: ReadonlyMap<string, ValueRequirement>;
}
export interface Value {
    rank: number;
    domain: number;
    dimensions: Map<number, number>;
    fields: Map<string, Value>;
    fact: ValueFacts;
    node: AstNode;
}
export interface Binding { name: string; node: AstNode; rank: number; value: Value; }
interface DomainConstraint { variable: number; types: readonly string[]; site: RequirementSite; }
export interface Template {
    graph: Graph;
    params: Value[];
    result: Value;
}
const site = (node: AstNode, reason: string): RequirementSite => ({ node, reason });

export class Graph {
    readonly solver = new RequirementSolver();
    readonly bindings: Binding[] = [];
    readonly expressions = new Map<Expression, Value>();
    readonly domains: DomainConstraint[] = [];
    readonly domainLinks: [number, number][] = [];
    readonly inhabited = new Set<number>();
    private readonly shapeParents = new WeakMap<Map<number, number>, Map<number, number>>();
    private readonly fieldParents = new WeakMap<Map<string, Value>, Map<string, Value>>();
    private readonly symbols = new Map<string, number>();
    private readonly shapeFacts = new WeakMap<Map<number, number>, ValueFacts>();
    shape(value: Value): ValueFacts { return this.shapeFacts.get(this.dimensions(value)) ?? value.fact; }
    dimensions(value: Value): Map<number, number> {
        const root = (map: Map<number, number>): Map<number, number> => {
            const parent = this.shapeParents.get(map);
            if (!parent) return map;
            const result = root(parent); this.shapeParents.set(map, result); return result;
        };
        return root(value.dimensions);
    }
    fields(value: Value): Map<string, Value> {
        let fields = value.fields;
        const path: Map<string, Value>[] = [];
        for (let parent = this.fieldParents.get(fields); parent; parent = this.fieldParents.get(fields)) {
            path.push(fields); fields = parent;
        }
        for (const map of path) this.fieldParents.set(map, fields);
        return fields;
    }
    /** Connect repeated selections and aliases without manufacturing a forward field fact. */
    field(value: Value, name: string, node: AstNode, fact: ValueFacts = UNKNOWN_VALUE): Value {
        const fields = this.fields(value);
        let selected = fields.get(name);
        if (!selected) { selected = this.value(node, fact); fields.set(name, selected); }
        return selected;
    }
    private symbolic(dim: Dim, at: RequirementSite): number | undefined {
        if (dim.constant < 0 || dim.terms.some(([, n]) => !Number.isSafeInteger(n) || n <= 0)) return;
        let result = this.solver.variable('dimension');
        this.solver.bound(result, dim.constant, dim.constant, at);
        for (const [name, coefficient] of dim.terms) {
            let term = this.symbols.get(name);
            if (term === undefined) { term = this.solver.variable('dimension'); this.symbols.set(name, term); }
            let count = coefficient;
            while (count > 0) {
                if (count % 2) {
                    const sum = this.solver.variable('dimension');
                    this.solver.sum(sum, result, term, at); result = sum;
                }
                count = Math.floor(count / 2);
                if (count) {
                    const doubled = this.solver.variable('dimension');
                    this.solver.sum(doubled, term, term, at); term = doubled;
                }
            }
        }
        return result;
    }
    value(node: AstNode, fact: ValueFacts = UNKNOWN_VALUE): Value {
        const rank = this.solver.variable();
        const value = { rank, domain: rank, dimensions: new Map<number, number>(), fields: new Map<string, Value>(), fact, node };
        if (fact.rank === 0 || fact.types.join() === 'text'
            || fact.shape?.every(n => n !== null && n > 0)) this.inhabited.add(rank);
        this.shapeFacts.set(value.dimensions, fact);
        if (fact.rank !== undefined) this.solver.bound(rank, fact.rank, fact.rank, site(node, `rank ${fact.rank}`));
        // An explicit fill establishes a domain even when there are no cells.
        const types = fact.types.join() === 'array' || fact.types.join() === 'sequence'
            ? fact.shape?.every(n => n !== null && n > 0) ? fact.elements : undefined : fact.types;
        const established = contractElements(fact.acceptedArrayContract ?? fact.declaredArrayContract);
        if (established?.length) this.domains.push({ variable: rank, types: established,
            site: site(node, `established array elements: ${established.join(' or ')}`) });
        if (types?.length) this.domains.push({ variable: rank, types, site: site(node, types.join(' or ')) });
        return value;
    }
    nameValue(value: Value): void {
        value.fact = withPathDims(value.fact);
        const shape = this.dimensions(value);
        if (value.fact.rank !== undefined) this.shapeFacts.set(shape, value.fact);
    }
    dimension(value: Value, axis: number): number {
        const dimensions = this.dimensions(value);
        let id = dimensions.get(axis);
        if (id !== undefined) return id;
        id = this.solver.variable('dimension');
        dimensions.set(axis, id);
        const fact = this.shape(value);
        const length = fact.shape?.[axis];
        if (typeof length === 'number') this.solver.bound(id, length, length, site(value.node, `length ${length}`));
        const symbolic = fact.dims?.[axis];
        if (symbolic) {
            const variable = this.symbolic(symbolic, site(value.node, 'symbolic length'));
            if (variable !== undefined) this.solver.equal(id, variable, site(value.node, 'symbolic length'));
        }
        return id;
    }
    same(left: Value, right: Value, at: RequirementSite, dimensions = true): void {
        this.solver.equal(left.rank, right.rank, at);
        this.domainLinks.push([left.domain, right.domain]);
        if (dimensions) {
            // Share the map: dimensions discovered by a later consumer also reach the producer.
            const a = this.dimensions(left), b = this.dimensions(right);
            // Materialize evidence on both sides before sharing an existing axis.
            // Otherwise an argument's known length can be lost behind a template ID.
            for (const axis of new Set([...a.keys(), ...b.keys()])) {
                this.dimension(left, axis);
                this.dimension(right, axis);
            }
            for (const [axis, id] of a) {
                const other = b.get(axis);
                if (other !== undefined) this.solver.equal(id, other, at);
                else b.set(axis, id);
            }
            if (a !== b) {
                const source = this.shapeFacts.get(b), other = this.shapeFacts.get(a);
                if (other?.shape && !source?.shape || other?.rank !== undefined && source?.rank === undefined) this.shapeFacts.set(b, other!);
                this.shapeParents.set(a, b);
            }
        }
        // Share before descending: recursive structures and aliases cannot recurse forever.
        const a = this.fields(left), b = this.fields(right);
        if (a !== b) {
            this.fieldParents.set(a, b);
            for (const [name, field] of a) {
                const other = b.get(name);
                if (other) this.same(field, other, at);
                else b.set(name, field);
            }
        }
    }
    instantiate(template: Template): { params: Value[]; result: Value } {
        const map = this.solver.copy(template.graph.solver);
        for (const id of template.graph.inhabited) this.inhabited.add(map(id));
        this.domains.push(...template.graph.domains.map(item => ({ ...item, variable: map(item.variable) })));
        this.domainLinks.push(...template.graph.domainLinks.map(([a, b]): [number, number] => [map(a), map(b)]));
        const shapes = new Map<Map<number, number>, Map<number, number>>();
        const fields = new Map<Map<string, Value>, Map<string, Value>>();
        const values = new Map<Value, Value>();
        const copy = (value: Value): Value => {
            const cached = values.get(value);
            if (cached) return cached;
            const original = template.graph.dimensions(value);
            let dimensions = shapes.get(original);
            if (!dimensions) { dimensions = new Map([...original].map(([axis, id]) => [axis, map(id)])); shapes.set(original, dimensions); this.shapeFacts.set(dimensions, template.graph.shape(value)); }
            const originalFields = template.graph.fields(value);
            let selections = fields.get(originalFields);
            const fresh = !selections;
            if (!selections) { selections = new Map(); fields.set(originalFields, selections); }
            const result = { ...value, rank: map(value.rank), domain: map(value.domain), dimensions, fields: selections };
            values.set(value, result);
            if (fresh) for (const [name, selected] of originalFields) selections.set(name, copy(selected));
            return result;
        };
        return { params: template.params.map(copy), result: copy(template.result) };
    }
    solve() {
        const solved = this.solver.solve();
        const parent = this.solver.variables.map((_, i) => i);
        const find = (id: number): number => parent[id] === id ? id : parent[id] = find(parent[id]);
        for (const [a, b] of this.domainLinks) parent[find(a)] = find(b);
        const inhabited = new Set([...this.inhabited].map(find));
        const domains = new Map<number, { types: readonly string[]; sites: DomainConstraint[] }>();
        const conflicts = [...solved.conflicts];
        for (const item of this.domains) {
            const root = find(item.variable), old = domains.get(root);
            const types = old ? old.types.filter(type => item.types.includes(type)) : item.types;
            if (old?.types.length && !types.length && inhabited.has(root)) {
                const previous = old.sites.find(other => !other.types.some(type => item.types.includes(type)));
                if (previous) conflicts.push({ kind: 'domain', first: previous.site, second: item.site });
            }
            const sites = old?.sites ?? [];
            sites.push(item);
            domains.set(root, { types, sites });
        }
        let limited = solved.limited;
        const visit = (value: Value, active: ReadonlySet<Map<string, Value>>, budget: { remaining: number }): ValueRequirement => {
            const selections = this.fields(value);
            const cyclic = active.has(selections) || active.size >= 256 || budget.remaining-- <= 0;
            limited ||= cyclic;
            const path = new Set(active); path.add(selections);
            return { rank: solved.intervals[value.rank], domains: domains.get(find(value.domain))?.types,
                dimensions: new Map([...this.dimensions(value)].map(([axis, id]) => [axis, solved.intervals[id]])),
                ...(!cyclic && selections.size ? { fields: new Map([...selections]
                    .map(([name, selected]) => [name, visit(selected, path, budget)])) } : {}) };
        };
        const answers = new Map<Value, ValueRequirement>();
        const read = (value: Value): ValueRequirement => {
            let answer = answers.get(value);
            if (!answer) { answer = visit(value, new Set(), { remaining: 20_000 }); answers.set(value, answer); }
            return answer;
        };
        return { ...solved, conflicts, read, get limited() { return limited; } };
    }
}
