import { MissingValueError, RankError } from './errors.js';
import { setValueKey } from './set.js';
import {
    isRankArray,
    isRankLabel,
    isRankSequence,
    type RankGraph,
    type RankSequence,
    type RankValue,
} from './value.js';
import { native } from './modules/shared.js';

type GraphDirection = 'directed' | 'undirected';

interface GraphEdge {
    readonly target: RankValue;
    readonly weight: bigint | number;
}

/** Mutable adjacency storage behind Rank's graph value. */
export class GraphValue implements RankGraph {
    readonly kind = 'graph' as const;
    readonly vertices = new Map<string, RankValue>();
    readonly adjacency = new Map<string, GraphEdge[]>();

    constructor(
        readonly directed: boolean,
        readonly open: boolean,
    ) {}

    get size(): number { return this.vertices.size; }

    addVertex(value: RankValue): void {
        const key = graphKey(value);
        if (this.vertices.has(key)) return;
        this.vertices.set(key, value);
        this.adjacency.set(key, []);
    }

    addEdge(left: RankValue, right: RankValue, weight: RankValue = 1n): void {
        const numericWeight = graphWeight(weight);
        if (this.open) {
            this.addVertex(left);
            this.addVertex(right);
        } else {
            this.requireVertex(left);
            this.requireVertex(right);
        }
        this.adjacency.get(graphKey(left))!.push({ target: right, weight: numericWeight });
        if (!this.directed && graphKey(left) !== graphKey(right)) {
            this.adjacency.get(graphKey(right))!.push({ target: left, weight: numericWeight });
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
        for (const vertex of graphVertices(value)) {
            if (this.open) this.addVertex(vertex);
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
                        yield {
                            kind: 'array',
                            items: [edge.target, edge.weight],
                            shape: [2],
                        };
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

function graphKey(value: RankValue): string {
    if (typeof value === 'bigint' || typeof value === 'number'
        || typeof value === 'boolean' || typeof value === 'string'
        || isRankLabel(value)) return setValueKey(value);
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
