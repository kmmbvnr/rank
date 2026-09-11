import { RankError } from '../errors.js';
import { expectGraph, type GraphValue } from '../graph.js';
import { indexKey } from '../index-key.js';
import { ResourceMap } from '../resource-summary.js';
import { setValueKey } from '../set.js';
import {
    type RankArray,
    type RankIndex,
    type RankRecord,
    type RankValue,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

type Numeric = bigint | number;

interface SearchState {
    readonly distance: Map<string, Numeric>;
    readonly parent: Map<string, RankValue>;
    readonly order: RankValue[];
}

export const graphModule: RuntimeModule = {
    bfs: () => native('bfs', 2, values => {
        const graph = expectGraph(values[0]);
        return searchRecord(graph, breadthFirst(graph, values[1]));
    }),
    dfs: () => native('dfs', 2, values => {
        const graph = expectGraph(values[0]);
        return searchRecord(graph, depthFirst(graph, values[1]));
    }),
    components: () => native('components', 1, values =>
        componentRecord(expectGraph(values[0]))),
    bipartite: () => native('bipartite', 1, values =>
        bipartiteRecord(expectGraph(values[0]))),
    dijkstra: () => native('dijkstra', 2, values => {
        const graph = expectGraph(values[0]);
        return searchRecord(graph, dijkstra(graph, values[1]));
    }),
    bellmanford: () => native('bellmanford', 2, values => {
        const graph = expectGraph(values[0]);
        return bellmanFordRecord(graph, values[1]);
    }),
    topological: () => native('topological', 1, values =>
        topologicalRecord(expectGraph(values[0]))),
    scc: () => native('scc', 1, values =>
        stronglyConnectedRecord(expectGraph(values[0]))),
    floyd: () => native('floyd', 1, values =>
        floydRecord(expectGraph(values[0]))),
    mst: () => native('mst', 1, values =>
        minimumSpanningTreeRecord(expectGraph(values[0]))),
};

function floydRecord(graph: GraphValue): RankRecord {
    const vertices = [...graph.vertices.values()];
    const positions = new Map(vertices.map((value, index) => [setValueKey(value), index]));
    const size = vertices.length;
    const distance: Array<Numeric | undefined> = Array(size * size).fill(undefined);
    for (let index = 0; index < size; index += 1) distance[index * size + index] = 0n;
    for (const [from, edges] of graph.adjacency) {
        const row = positions.get(from)!;
        for (const edge of edges) {
            const column = positions.get(setValueKey(edge.target))!;
            const offset = row * size + column;
            const previous = distance[offset];
            if (previous === undefined || numericCompare(edge.weight, previous) < 0) {
                distance[offset] = edge.weight;
            }
        }
    }
    for (let middle = 0; middle < size; middle += 1) {
        for (let from = 0; from < size; from += 1) {
            const left = distance[from * size + middle];
            if (left === undefined) continue;
            for (let to = 0; to < size; to += 1) {
                const right = distance[middle * size + to];
                if (right === undefined) continue;
                const offset = from * size + to;
                const candidate = numericAdd(left, right);
                const previous = distance[offset];
                if (previous === undefined || numericCompare(candidate, previous) < 0) {
                    distance[offset] = candidate;
                }
            }
        }
    }
    const entries = new ResourceMap<RankValue>(value => value);
    const negative = new Set<string>();
    for (let from = 0; from < size; from += 1) {
        if (numericCompare(distance[from * size + from]!, 0n) < 0) {
            negative.add(setValueKey(vertices[from]));
        }
        for (let to = 0; to < size; to += 1) {
            const value = distance[from * size + to];
            if (value !== undefined) entries.set(indexKey([vertices[from], vertices[to]]), value);
        }
    }
    const index = entries.resources.track({ kind: 'index' as const, entries });
    return record({ distance: index, negative: setFrom(graph, negative) });
}

function minimumSpanningTreeRecord(graph: GraphValue): RankRecord {
    requireUndirected(graph, 'mst');
    const vertices = [...graph.vertices.values()];
    const position = new Map(vertices.map((value, index) => [setValueKey(value), index]));
    const edges: Array<{ from: RankValue; to: RankValue; weight: Numeric }> = [];
    for (const [fromKey, outgoing] of graph.adjacency) {
        const fromIndex = position.get(fromKey)!;
        for (const edge of outgoing) {
            const toIndex = position.get(setValueKey(edge.target))!;
            if (fromIndex <= toIndex) {
                edges.push({ from: vertices[fromIndex], to: edge.target, weight: edge.weight });
            }
        }
    }
    edges.sort((left, right) => numericCompare(left.weight, right.weight));
    const parent = vertices.map((_, index) => index);
    const sizes = vertices.map(() => 1);
    const find = (value: number): number => {
        let root = value;
        while (parent[root] !== root) root = parent[root];
        while (parent[value] !== value) {
            const next = parent[value];
            parent[value] = root;
            value = next;
        }
        return root;
    };
    const selected: typeof edges = [];
    let weight: Numeric = 0n;
    let components = vertices.length;
    for (const edge of edges) {
        let left = find(position.get(setValueKey(edge.from))!);
        let right = find(position.get(setValueKey(edge.to))!);
        if (left === right) continue;
        if (sizes[left] < sizes[right]) [left, right] = [right, left];
        parent[right] = left;
        sizes[left] += sizes[right];
        components -= 1;
        selected.push(edge);
        weight = numericAdd(weight, edge.weight);
    }
    const items = selected.flatMap(edge => [edge.from, edge.to, edge.weight]);
    return record({
        connected: components <= 1,
        components: BigInt(components),
        weight,
        edges: { kind: 'array', items, shape: [selected.length, 3] },
    });
}

function breadthFirst(graph: GraphValue, start: RankValue): SearchState {
    const startKey = requireVertex(graph, start);
    const distance = new Map<string, Numeric>([[startKey, 0n]]);
    const parent = new Map<string, RankValue>();
    const order: RankValue[] = [];
    const queue: RankValue[] = [start];
    for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        const currentKey = setValueKey(current);
        order.push(current);
        for (const edge of graph.adjacency.get(currentKey) ?? []) {
            const nextKey = setValueKey(edge.target);
            if (distance.has(nextKey)) continue;
            distance.set(nextKey, BigInt(distance.get(currentKey) as bigint) + 1n);
            parent.set(nextKey, current);
            queue.push(edge.target);
        }
    }
    return { distance, parent, order };
}

function depthFirst(graph: GraphValue, start: RankValue): SearchState {
    const startKey = requireVertex(graph, start);
    const distance = new Map<string, Numeric>([[startKey, 0n]]);
    const parent = new Map<string, RankValue>();
    const order: RankValue[] = [];
    const stack: RankValue[] = [start];
    while (stack.length > 0) {
        const current = stack.pop()!;
        const currentKey = setValueKey(current);
        order.push(current);
        const edges = graph.adjacency.get(currentKey) ?? [];
        for (let position = edges.length - 1; position >= 0; position -= 1) {
            const next = edges[position].target;
            const nextKey = setValueKey(next);
            if (distance.has(nextKey)) continue;
            distance.set(nextKey, BigInt(distance.get(currentKey) as bigint) + 1n);
            parent.set(nextKey, current);
            stack.push(next);
        }
    }
    return { distance, parent, order };
}

function topologicalRecord(graph: GraphValue): RankRecord {
    requireDirected(graph, 'topological');
    const indegree = new Map<string, number>();
    for (const key of graph.vertices.keys()) indegree.set(key, 0);
    for (const edges of graph.adjacency.values()) {
        for (const edge of edges) {
            const key = setValueKey(edge.target);
            indegree.set(key, indegree.get(key)! + 1);
        }
    }
    const queue = [...graph.vertices]
        .filter(([key]) => indegree.get(key) === 0)
        .map(([, vertex]) => vertex);
    const order: RankValue[] = [];
    for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        order.push(current);
        for (const edge of graph.adjacency.get(setValueKey(current)) ?? []) {
            const key = setValueKey(edge.target);
            const remaining = indegree.get(key)! - 1;
            indegree.set(key, remaining);
            if (remaining === 0) queue.push(edge.target);
        }
    }
    return record({
        possible: order.length === graph.size,
        order: array(order.length === graph.size ? order : []),
    });
}

function stronglyConnectedRecord(graph: GraphValue): RankRecord {
    requireDirected(graph, 'scc');
    const finished: string[] = [];
    const visited = new Set<string>();
    for (const root of graph.vertices.keys()) {
        if (visited.has(root)) continue;
        finishFrom(graph, root, visited, finished);
    }

    const reverse = new Map<string, string[]>();
    for (const key of graph.vertices.keys()) reverse.set(key, []);
    for (const [from, edges] of graph.adjacency) {
        for (const edge of edges) reverse.get(setValueKey(edge.target))!.push(from);
    }

    const component = new Map<string, RankValue>();
    const roots: RankValue[] = [];
    let count = 0n;
    while (finished.length > 0) {
        const root = finished.pop()!;
        if (component.has(root)) continue;
        count += 1n;
        roots.push(graph.vertices.get(root)!);
        const stack = [root];
        component.set(root, count);
        while (stack.length > 0) {
            const current = stack.pop()!;
            const edges = reverse.get(current)!;
            for (let position = edges.length - 1; position >= 0; position -= 1) {
                const next = edges[position];
                if (component.has(next)) continue;
                component.set(next, count);
                stack.push(next);
            }
        }
    }
    return record({
        count,
        component: indexFrom(graph, component),
        roots: array(roots),
    });
}

function finishFrom(
    graph: GraphValue,
    root: string,
    visited: Set<string>,
    finished: string[],
): void {
    const stack: Array<{ key: string; next: number }> = [{ key: root, next: 0 }];
    visited.add(root);
    while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const edges = graph.adjacency.get(frame.key) ?? [];
        if (frame.next < edges.length) {
            const next = setValueKey(edges[frame.next++].target);
            if (!visited.has(next)) {
                visited.add(next);
                stack.push({ key: next, next: 0 });
            }
            continue;
        }
        finished.push(frame.key);
        stack.pop();
    }
}

function dijkstra(graph: GraphValue, start: RankValue): SearchState {
    const startKey = requireVertex(graph, start);
    rejectNegativeWeights(graph);
    const distance = new Map<string, Numeric>([[startKey, 0n]]);
    const parent = new Map<string, RankValue>();
    const order: RankValue[] = [];
    const settled = new Set<string>();
    const heap = new MinHeap();
    heap.push({ vertex: start, distance: 0n });
    while (heap.size > 0) {
        const entry = heap.pop()!;
        const key = setValueKey(entry.vertex);
        if (settled.has(key) || numericCompare(entry.distance, distance.get(key)!) !== 0) {
            continue;
        }
        settled.add(key);
        order.push(entry.vertex);
        for (const edge of graph.adjacency.get(key) ?? []) {
            const nextKey = setValueKey(edge.target);
            const candidate = numericAdd(entry.distance, edge.weight);
            const previous = distance.get(nextKey);
            if (previous !== undefined && numericCompare(candidate, previous) >= 0) continue;
            distance.set(nextKey, candidate);
            parent.set(nextKey, entry.vertex);
            heap.push({ vertex: edge.target, distance: candidate });
        }
    }
    return { distance, parent, order };
}

function bellmanFordRecord(graph: GraphValue, start: RankValue): RankRecord {
    const startKey = requireVertex(graph, start);
    const distance = new Map<string, Numeric>([[startKey, 0n]]);
    const parent = new Map<string, RankValue>();
    for (let pass = 1; pass < graph.size; pass += 1) {
        let changed = false;
        for (const [from, edges] of graph.adjacency) {
            const base = distance.get(from);
            if (base === undefined) continue;
            for (const edge of edges) {
                const to = setValueKey(edge.target);
                const candidate = numericAdd(base, edge.weight);
                const previous = distance.get(to);
                if (previous !== undefined && numericCompare(candidate, previous) >= 0) continue;
                distance.set(to, candidate);
                parent.set(to, graph.vertices.get(from)!);
                changed = true;
            }
        }
        if (!changed) break;
    }

    const negativeKeys = new Set<string>();
    const queue: RankValue[] = [];
    for (const [from, edges] of graph.adjacency) {
        const base = distance.get(from);
        if (base === undefined) continue;
        for (const edge of edges) {
            const to = setValueKey(edge.target);
            const previous = distance.get(to);
            if (previous !== undefined
                && numericCompare(numericAdd(base, edge.weight), previous) < 0
                && !negativeKeys.has(to)) {
                negativeKeys.add(to);
                queue.push(edge.target);
            }
        }
    }
    for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        for (const edge of graph.adjacency.get(setValueKey(current)) ?? []) {
            const key = setValueKey(edge.target);
            if (negativeKeys.has(key)) continue;
            negativeKeys.add(key);
            queue.push(edge.target);
        }
    }
    return record({
        distance: indexFrom(graph, distance),
        parent: indexFrom(graph, parent),
        negative: setFrom(graph, negativeKeys),
    });
}

function componentRecord(graph: GraphValue): RankRecord {
    requireUndirected(graph, 'components');
    const component = new Map<string, Numeric>();
    const roots: RankValue[] = [];
    let count = 0n;
    for (const root of graph.vertices.values()) {
        const rootKey = setValueKey(root);
        if (component.has(rootKey)) continue;
        count += 1n;
        roots.push(root);
        const queue: RankValue[] = [root];
        component.set(rootKey, count);
        for (let head = 0; head < queue.length; head += 1) {
            const current = queue[head];
            for (const edge of graph.adjacency.get(setValueKey(current)) ?? []) {
                const key = setValueKey(edge.target);
                if (component.has(key)) continue;
                component.set(key, count);
                queue.push(edge.target);
            }
        }
    }
    return record({
        count,
        component: indexFrom(graph, component),
        roots: array(roots),
    });
}

function bipartiteRecord(graph: GraphValue): RankRecord {
    requireUndirected(graph, 'bipartite');
    const color = new Map<string, Numeric>();
    let possible = true;
    for (const root of graph.vertices.values()) {
        const rootKey = setValueKey(root);
        if (color.has(rootKey)) continue;
        color.set(rootKey, 1n);
        const queue: RankValue[] = [root];
        for (let head = 0; head < queue.length; head += 1) {
            const current = queue[head];
            const currentColor = color.get(setValueKey(current)) as bigint;
            for (const edge of graph.adjacency.get(setValueKey(current)) ?? []) {
                const key = setValueKey(edge.target);
                const nextColor = color.get(key);
                if (nextColor === undefined) {
                    color.set(key, 3n - currentColor);
                    queue.push(edge.target);
                } else if (nextColor === currentColor) {
                    possible = false;
                }
            }
        }
    }
    return record({ possible, color: indexFrom(graph, color) });
}

function searchRecord(graph: GraphValue, state: SearchState): RankRecord {
    return record({
        distance: indexFrom(graph, state.distance),
        parent: indexFrom(graph, state.parent),
        order: array(state.order),
    });
}

function indexFrom(
    graph: GraphValue,
    values: ReadonlyMap<string, RankValue>,
): RankIndex {
    const entries = new ResourceMap<RankValue>(value => value);
    for (const [key, value] of values) {
        const vertex = graph.vertices.get(key)!;
        entries.set(indexKey([vertex]), value);
    }
    return entries.resources.track({ kind: 'index', entries });
}

function setFrom(graph: GraphValue, keys: ReadonlySet<string>): RankValue {
    const entries = new ResourceMap<RankValue>(value => value);
    for (const key of keys) {
        const vertex = graph.vertices.get(key)!;
        entries.set(setValueKey(vertex), vertex);
    }
    return entries.resources.track({ kind: 'set', entries });
}

function record(fields: Record<string, RankValue>): RankRecord {
    const entries = new ResourceMap<RankValue>(value => value);
    const types = new Map<string, string>();
    for (const [name, value] of Object.entries(fields)) {
        entries.set(name, value);
        types.set(name, valueType(value));
    }
    return entries.resources.track({ kind: 'record', entries, types });
}

function array(items: RankValue[]): RankArray {
    return { kind: 'array', items, shape: [items.length] };
}

function valueType(value: RankValue): string {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'text';
    return value.kind === 'label' ? 'symbol' : value.kind;
}

function requireVertex(graph: GraphValue, vertex: RankValue): string {
    const key = setValueKey(vertex);
    if (!graph.vertices.has(key)) throw new RankError('graph does not contain the start vertex');
    return key;
}

function requireUndirected(graph: GraphValue, operation: string): void {
    if (graph.directed) throw new RankError(`${operation} expects an undirected graph`);
}

function requireDirected(graph: GraphValue, operation: string): void {
    if (!graph.directed) throw new RankError(`${operation} expects a directed graph`);
}

function rejectNegativeWeights(graph: GraphValue): void {
    for (const edges of graph.adjacency.values()) {
        for (const edge of edges) {
            if (numericCompare(edge.weight, 0n) < 0) {
                throw new RankError('dijkstra requires nonnegative edge weights');
            }
        }
    }
}

function numericAdd(left: Numeric, right: Numeric): Numeric {
    return typeof left === 'number' || typeof right === 'number'
        ? Number(left) + Number(right)
        : left + right;
}

function numericCompare(left: Numeric, right: Numeric): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

interface HeapEntry {
    readonly vertex: RankValue;
    readonly distance: Numeric;
}

class MinHeap {
    private readonly items: HeapEntry[] = [];

    get size(): number { return this.items.length; }

    push(value: HeapEntry): void {
        this.items.push(value);
        let index = this.items.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (numericCompare(this.items[parent].distance, value.distance) <= 0) break;
            this.items[index] = this.items[parent];
            index = parent;
        }
        this.items[index] = value;
    }

    pop(): HeapEntry | undefined {
        const first = this.items[0];
        const last = this.items.pop();
        if (last === undefined || this.items.length === 0) return first;
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            if (left >= this.items.length) break;
            const right = left + 1;
            const child = right < this.items.length
                && numericCompare(this.items[right].distance, this.items[left].distance) < 0
                ? right : left;
            if (numericCompare(this.items[child].distance, last.distance) >= 0) break;
            this.items[index] = this.items[child];
            index = child;
        }
        this.items[index] = last;
        return first;
    }
}
