import { MissingValueError, RankError } from './errors.js';
import { setValueKey } from './set.js';
import {
    tuple, isRankArray,
    isRankLabel,
    isRankSequence,
    isRankRecord,
    type RankGraph,
    type NativeFunction,
    type RankSequence,
    type RankValue,
} from './value.js';
import { checkpoint } from './interrupt.js';
import { native } from './modules/shared.js';

type GraphDirection = 'directed' | 'undirected';

export interface GraphEdge {
    readonly target: RankValue;
    readonly weight: bigint | number;
    readonly id: number;
}

/** Local traversal needs no complete vertex table, mutation API, or edge IDs.
 * Providers must return finite outgoing iterables in stable traversal order.
 * Vertex identity follows Rank's scalar set/index equality.
 */
export interface TraversalGraph {
    /** Validate the start and return setValueKey(vertex). */
    requireStart(vertex: RankValue): string;
    outgoingEdges(vertex: RankValue): Iterable<Pick<GraphEdge, 'target' | 'weight'>>;
}

export function expectGraph(value: RankValue): GraphValue {
    const graph = expectReadableGraph(value);
    if (graph instanceof PredicateGraph) throw new RankError('graph algorithm requires an explicit graph');
    return graph;
}

export function expectReadableGraph(value: RankValue): RankGraph {
    if (typeof value === 'object' && value.kind === 'graph') return value;
    throw new RankError('graph algorithm expects a graph');
}

/** Mutable adjacency storage behind Rank's graph value. */
export class GraphValue implements TraversalGraph {
    readonly kind = 'graph' as const;
    readonly vertices = new Map<string, RankValue>();
    readonly adjacency = new Map<string, GraphEdge[]>();
    private nextEdgeId = 0;

    constructor(
        readonly directed: boolean,
        readonly open: boolean,
    ) {}

    get size(): number { return this.vertices.size; }

    requireStart(vertex: RankValue): string {
        const key = setValueKey(vertex);
        if (!this.vertices.has(key)) throw new RankError('graph does not contain the start vertex');
        return key;
    }

    outgoingEdges(vertex: RankValue): readonly GraphEdge[] {
        return this.adjacency.get(setValueKey(vertex)) ?? [];
    }

    adjacent(left: RankValue, right: RankValue): boolean {
        this.requireVertex(left);
        this.requireVertex(right);
        const target = graphKey(right);
        for (const edge of this.outgoingEdges(left)) {
            checkpoint('checking graph adjacency');
            if (graphKey(edge.target) === target) return true;
        }
        return false;
    }

    addVertex(value: RankValue): void {
        const key = graphKey(value);
        if (this.vertices.has(key)) return;
        this.vertices.set(key, value);
        this.adjacency.set(key, []);
    }

    addEdge(left: RankValue, right: RankValue, weight: RankValue = 1n): void {
        const numericWeight = graphWeight(weight);
        const id = this.nextEdgeId++;
        if (this.open) {
            this.addVertex(left);
            this.addVertex(right);
        } else {
            this.requireVertex(left);
            this.requireVertex(right);
        }
        this.adjacency.get(graphKey(left))!.push({ target: right, weight: numericWeight, id });
        if (!this.directed && graphKey(left) !== graphKey(right)) {
            this.adjacency.get(graphKey(right))!.push({ target: left, weight: numericWeight, id });
        }
    }

    add(arguments_: readonly RankValue[]): void {
        if (arguments_.length === 2 || arguments_.length === 3) {
            this.addEdge(arguments_[0], arguments_[1], arguments_[2]);
            return;
        }
        if (arguments_.length !== 1) {
            throw new RankError('graph add expects one collection or two vertices');
        }
        const value = arguments_[0];
        if (isRankArray(value) && value.shape.length === 2) {
            const width = value.shape[1];
            if (width !== 2 && width !== 3) {
                throw new RankError('graph edge array must have shape M by 2 or M by 3');
            }
            for (let row = 0; row < value.shape[0]; row += 1) {
                const offset = row * width;
                this.addEdge(
                    arrayItem(value, offset),
                    arrayItem(value, offset + 1),
                    width === 3 ? arrayItem(value, offset + 2) : 1n,
                );
            }
            return;
        }
        for (const vertex of isRankRecord(value) ? [value] : graphVertices(value)) {
            if (isRankRecord(vertex)) {
                const source = vertex.entries.get('source');
                const target = vertex.entries.get('target');
                if (source === undefined || target === undefined) {
                    throw new RankError('graph edge records require .source and .target');
                }
                this.addEdge(source, target, vertex.entries.get('weight') ?? 1n);
            } else if (this.open) this.addVertex(vertex);
            else this.requireVertex(vertex);
        }
    }

    neighbors(vertex: RankValue): RankSequence {
        const key = graphKey(vertex);
        if (!this.vertices.has(key) && !this.open) {
            throw new MissingValueError('graph does not contain the vertex');
        }
        const neighbors = [...this.adjacency.get(key) ?? []].map(edge => edge.target);
        return {
            kind: 'sequence',
            plan: {
                name: 'graph neighbors',
                size: { kind: 'exact', value: BigInt(neighbors.length) },
                *iterate() { yield* neighbors; },
            },
        };
    }

    edges(vertex: RankValue): RankSequence {
        const key = graphKey(vertex);
        if (!this.vertices.has(key) && !this.open) {
            throw new MissingValueError('graph does not contain the vertex');
        }
        const edges = [...this.adjacency.get(key) ?? []];
        return {
            kind: 'sequence',
            plan: {
                name: 'graph edges',
                size: { kind: 'exact', value: BigInt(edges.length) },
                *iterate() {
                    for (const edge of edges) {
                        yield tuple([edge.target, edge.weight]);
                    }
                },
            },
        };
    }

    private requireVertex(value: RankValue): void {
        const key = graphKey(value);
        if (!this.vertices.has(key)) {
            throw new MissingValueError('graph does not contain the vertex');
        }
    }
}

/** Finite, read-only relation. Captured callback state remains live; no results are cached. */
export class PredicateGraph implements TraversalGraph {
    readonly kind = 'graph' as const;
    readonly directed: boolean;
    readonly captures: readonly ReadonlyMap<string, RankValue>[];
    private readonly domain = new Map<string, RankValue>();

    constructor(
        values: RankValue,
        direction: RankValue,
        predicate: NativeFunction,
        private readonly invoke: (left: RankValue, right: RankValue) => RankValue,
    ) {
        this.directed = graphDirection(direction);
        if (!predicate.arities.includes(2)) throw new RankError('graph predicate expects two arguments');
        this.captures = [new Map([['predicate', predicate]])];
        for (const vertex of graphVertices(values)) {
            checkpoint('constructing predicate graph');
            const key = graphKey(vertex);
            if (!this.domain.has(key)) this.domain.set(key, vertex);
        }
    }

    get size(): number { return this.domain.size; }

    requireStart(vertex: RankValue): string {
        const key = graphKey(vertex);
        if (!this.domain.has(key)) throw new RankError('graph does not contain the start vertex');
        return key;
    }

    private requireVertex(vertex: RankValue): void {
        if (!this.domain.has(graphKey(vertex))) throw new MissingValueError('graph does not contain the vertex');
    }

    adjacent(left: RankValue, right: RankValue): boolean {
        this.requireVertex(left);
        this.requireVertex(right);
        checkpoint('checking graph adjacency');
        const result = this.invoke(this.domain.get(graphKey(left))!, this.domain.get(graphKey(right))!);
        if (typeof result !== 'boolean') throw new RankError('graph predicate must return a boolean');
        return result;
    }

    *outgoingEdges(vertex: RankValue): IterableIterator<Pick<GraphEdge, 'target' | 'weight'>> {
        this.requireVertex(vertex);
        for (const target of this.domain.values()) {
            if (this.adjacent(vertex, target)) yield { target, weight: 1n };
        }
    }

    neighbors(vertex: RankValue): RankSequence {
        this.requireVertex(vertex);
        const graph = this;
        return { kind: 'sequence', plan: {
            name: 'predicate graph neighbors', size: { kind: 'unknown' }, captures: this.captures,
            *iterate() { for (const edge of graph.outgoingEdges(vertex)) yield edge.target; },
            contains(value) {
                return isGraphVertex(value) && graph.domain.has(graphKey(value)) && graph.adjacent(vertex, value);
            },
        } };
    }

    edges(vertex: RankValue): RankSequence {
        this.requireVertex(vertex);
        const graph = this;
        return { kind: 'sequence', plan: {
            name: 'predicate graph edges', size: { kind: 'unknown' }, captures: this.captures,
            *iterate() { for (const edge of graph.outgoingEdges(vertex)) yield tuple([edge.target, edge.weight]); },
        } };
    }

    add(_arguments: readonly RankValue[]): never {
        throw new RankError('predicate graph is read-only');
    }
}

/** Constructor used by the `new graph ...` application. */
export function graphConstructor(): RankValue {
    return native('new graph', [1, 2], arguments_ => {
        const direction = arguments_.at(-1);
        const directed = graphDirection(direction);
        const graph = new GraphValue(directed, arguments_.length === 1);
        if (arguments_.length === 2) {
            for (const vertex of graphVertices(arguments_[0]!)) graph.addVertex(vertex);
        }
        return graph;
    });
}

function graphDirection(value: RankValue | undefined): boolean {
    if (value === undefined || !isRankLabel(value)
        || (value.name !== 'directed' && value.name !== 'undirected')) {
        throw new RankError('new graph expects .directed or .undirected');
    }
    return (value.name as GraphDirection) === 'directed';
}

function graphVertices(value: RankValue): Iterable<RankValue> {
    if (isRankArray(value)) {
        if (value.shape.length !== 1) {
            throw new RankError('graph vertices must be a rank-1 collection');
        }
        return Array.from({ length: value.shape[0] }, (_, index) => arrayItem(value, index));
    }
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError('graph vertices require a finite sequence');
        }
        return value.plan.iterate();
    }
    graphKey(value);
    return [value];
}

function isGraphVertex(value: RankValue): boolean {
    return typeof value === 'bigint' || typeof value === 'number'
        || typeof value === 'boolean' || typeof value === 'string' || isRankLabel(value);
}

function graphKey(value: RankValue): string {
    if (isGraphVertex(value)) return setValueKey(value);
    throw new RankError('graph vertices must be scalar values');
}

function graphWeight(value: RankValue): bigint | number {
    if (typeof value === 'bigint' || typeof value === 'number') return value;
    throw new RankError('graph edge weight must be numeric');
}

function arrayItem(value: Extract<RankValue, { kind: 'array' | 'bytes' }>, index: number): RankValue {
    const item = value.itemAt?.(index) ?? value.items[index];
    if (item === undefined) throw new RankError('graph collection is incomplete');
    return item;
}
