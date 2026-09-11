import { MissingValueError, RankError } from '../errors.js';
import { RankDsu } from '../dsu.js';
import { RankFunctionalGraph } from '../functional-graph.js';
import { expectGraph, type GraphValue } from '../graph.js';
import { indexKey } from '../index-key.js';
import { ResourceMap } from '../resource-summary.js';
import { sequence } from '../sequence.js';
import { setValueKey } from '../set.js';
import {
    type RankArray,
    type RankIndex,
    type RankRecord,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
    type SequencePredicateExpression,
    isRankDsu,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

type Numeric = bigint | number;

interface SearchState {
    readonly distance: Map<string, Numeric>;
    readonly parent: Map<string, RankValue>;
    readonly order: RankValue[];
}

interface RootedTreeState {
    readonly vertices: RankValue[];
    readonly positions: ReadonlyMap<string, number>;
    readonly depth: readonly number[];
    readonly jumps: readonly number[][];
}

const rootedTrees = new WeakMap<RankRecord, RootedTreeState>();

export const graphModule: RuntimeModule = {
    bfs: () => native('bfs', 2, values => {
        const graph = expectGraph(values[0]);
        return searchRecord(graph, breadthFirst(graph, values[1]));
    }),
    dfs: () => native('dfs', 2, values => {
        const graph = expectGraph(values[0]);
        return searchRecord(graph, depthFirst(graph, values[1]));
    }),
    components: () => native('components', 1, values => isRankDsu(values[0])
        ? values[0].components : componentRecord(expectGraph(values[0]))),
    find: () => native('find', 2, values => expectDsu(values[0]).find(values[1])),
    merge: () => native('merge', 3, values =>
        expectDsu(values[0]).merge(values[1], values[2])),
    connected: () => native('connected', 3, values =>
        expectDsu(values[0]).connected(values[1], values[2])),
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
    maxflow: () => native('maxflow', 3, values =>
        maximumFlowRecord(expectGraph(values[0]), values[1], values[2])),
    cycle: () => native('cycle', 1, values =>
        graphCycle(expectGraph(values[0]))),
    euler: () => native('euler', 2, values =>
        eulerTrail(expectGraph(values[0]), values[1])),
    root: () => native('root', 2, values =>
        rootedTree(expectGraph(values[0]), values[1])),
    ancestor: () => native('ancestor', 3, values =>
        rootedAncestor(values[0], values[1], values[2])),
    lca: () => native('lca', 3, values =>
        rootedLca(values[0], values[1], values[2])),
    functional: () => native('functional', 1, values =>
        new RankFunctionalGraph(values[0])),
    weighted: () => native('weighted', 2, values =>
        new RankFunctionalGraph(values[0], values[1])),
    jump: () => native('jump', 3, values =>
        expectFunctional(values[0]).jump(values[1], values[2])),
    distance: () => native('distance', 3, values => {
        if (isRootedTree(values[0])) {
            return rootedDistance(values[0], values[1], values[2]);
        }
        return expectFunctional(values[0]).distance(values[1], values[2]);
    }),
    lengths: () => native('lengths', 1, values =>
        expectFunctional(values[0]).lengths()),
    pathlengths: () => native('pathlengths', 1, values =>
        treePathLengths(expectGraph(values[0]))),
    upto: () => native('upto', 3, values =>
        expectFunctional(values[0]).upto(
            values[1], values[2],
        )),
};

interface TreeSnapshot {
    readonly adjacency: readonly (readonly number[])[];
}

interface DistanceBounds {
    readonly lower?: bigint;
    readonly upper?: bigint;
}

function treePathLengths(graph: GraphValue): RankValue {
    const tree = snapshotTree(graph, 'pathlengths');
    return sequence(pathLengthPlan(tree));
}

function pathLengthPlan(
    tree: TreeSnapshot,
    predicate?: SequencePredicate,
): SequencePlan {
    const size = BigInt(tree.adjacency.length);
    return {
        name: predicate
            ? `tree path lengths where ${predicate.name}`
            : 'tree path lengths',
        size: predicate
            ? { kind: 'unknown' }
            : { kind: 'exact', value: size * (size - 1n) / 2n },
        *iterate() {
            const count = tree.adjacency.length;
            for (let source = 0; source < count; source += 1) {
                const distance = new Int32Array(count).fill(-1);
                distance[source] = 0;
                const queue = [source];
                for (let next = 0; next < queue.length; next += 1) {
                    const vertex = queue[next];
                    for (const neighbor of tree.adjacency[vertex]) {
                        if (distance[neighbor] >= 0) continue;
                        distance[neighbor] = distance[vertex] + 1;
                        queue.push(neighbor);
                    }
                }
                for (let target = source + 1; target < count; target += 1) {
                    const value = BigInt(distance[target]);
                    if (!predicate || predicate.test(value)) yield value;
                }
            }
        },
        withFilter(next) {
            if (!predicate) return pathLengthPlan(tree, next);
            return pathLengthPlan(tree, {
                name: `${predicate.name} and ${next.name}`,
                expression: {
                    kind: 'logical',
                    operator: 'and',
                    left: predicate.expression,
                    right: next.expression,
                },
                test: value => predicate.test(value) && next.test(value),
            });
        },
        reduce(operation) {
            if (operation !== 'count' || !predicate?.expression) return undefined;
            const bounds = predicateBounds(predicate.expression);
            if (!bounds) return undefined;
            return countTreeDistances(tree, bounds);
        },
    };
}

function snapshotTree(graph: GraphValue, operation: string): TreeSnapshot {
    requireUndirected(graph, operation);
    const vertices = [...graph.vertices.keys()];
    const position = new Map(vertices.map((key, index) => [key, index]));
    const edgeIds = new Set<number>();
    const adjacency = vertices.map(key => graph.adjacency.get(key)!.map(edge => {
        edgeIds.add(edge.id);
        return position.get(setValueKey(edge.target))!;
    }));
    if (graph.size === 0 || edgeIds.size !== graph.size - 1) {
        throw new RankError(`${operation} expects a tree`);
    }
    const seen = new Uint8Array(graph.size);
    const pending = [0];
    seen[0] = 1;
    for (let next = 0; next < pending.length; next += 1) {
        for (const neighbor of adjacency[pending[next]]) {
            if (seen[neighbor]) continue;
            seen[neighbor] = 1;
            pending.push(neighbor);
        }
    }
    if (pending.length !== graph.size) {
        throw new RankError(`${operation} expects a connected tree`);
    }
    return { adjacency };
}

function predicateBounds(
    expression: SequencePredicateExpression,
): DistanceBounds | undefined {
    if (expression.kind === 'logical') {
        if (expression.operator !== 'and' || !expression.left || !expression.right) {
            return undefined;
        }
        const left = predicateBounds(expression.left);
        const right = predicateBounds(expression.right);
        if (!left || !right) return undefined;
        return intersectBounds(left, right);
    }
    if (expression.kind !== 'comparison'
        || typeof expression.scalar !== 'bigint') return undefined;
    let operator = expression.operator;
    if (!expression.sourceOnLeft) operator = reverseComparison(operator);
    const value = expression.scalar;
    if (operator === 'equal') return { lower: value, upper: value };
    if (operator === 'atleast') return { lower: value };
    if (operator === 'atmost') return { upper: value };
    if (operator === 'greater') return { lower: value + 1n };
    if (operator === 'less') return { upper: value - 1n };
    return undefined;
}

function reverseComparison(operator: string): string {
    if (operator === 'less') return 'greater';
    if (operator === 'greater') return 'less';
    if (operator === 'atleast') return 'atmost';
    if (operator === 'atmost') return 'atleast';
    return operator;
}

function intersectBounds(left: DistanceBounds, right: DistanceBounds): DistanceBounds {
    const lower = left.lower === undefined ? right.lower
        : right.lower === undefined ? left.lower
            : left.lower > right.lower ? left.lower : right.lower;
    const upper = left.upper === undefined ? right.upper
        : right.upper === undefined ? left.upper
            : left.upper < right.upper ? left.upper : right.upper;
    return { lower, upper };
}

function countTreeDistances(tree: TreeSnapshot, bounds: DistanceBounds): bigint {
    const count = tree.adjacency.length;
    const minimum = bounds.lower ?? 1n;
    const maximum = bounds.upper ?? BigInt(count - 1);
    const lower = Number(minimum < 1n ? 1n : minimum);
    const upper = Number(maximum > BigInt(count - 1) ? BigInt(count - 1) : maximum);
    if (lower > upper || upper < 1 || lower >= count) return 0n;

    const removed = new Uint8Array(count);
    const parent = new Int32Array(count);
    const sizes = new Int32Array(count);
    const components = [0];
    let result = 0;
    while (components.length > 0) {
        const start = components.pop()!;
        if (removed[start]) continue;
        const centroid = findCentroid(tree, start, removed, parent, sizes);
        const all = [0];
        for (const neighbor of tree.adjacency[centroid]) {
            if (removed[neighbor]) continue;
            const branch = collectDistances(tree, neighbor, centroid, removed, upper);
            result -= pairsInRange(branch, lower, upper);
            for (const distance of branch) all.push(distance);
        }
        result += pairsInRange(all, lower, upper);
        removed[centroid] = 1;
        for (const neighbor of tree.adjacency[centroid]) {
            if (!removed[neighbor]) components.push(neighbor);
        }
    }
    return BigInt(result);
}

function findCentroid(
    tree: TreeSnapshot,
    start: number,
    removed: Uint8Array,
    parent: Int32Array,
    sizes: Int32Array,
): number {
    const vertices = [start];
    parent[start] = -1;
    for (let next = 0; next < vertices.length; next += 1) {
        const vertex = vertices[next];
        for (const neighbor of tree.adjacency[vertex]) {
            if (removed[neighbor] || neighbor === parent[vertex]) continue;
            parent[neighbor] = vertex;
            vertices.push(neighbor);
        }
    }
    for (let index = vertices.length - 1; index >= 0; index -= 1) {
        const vertex = vertices[index];
        let size = 1;
        for (const neighbor of tree.adjacency[vertex]) {
            if (!removed[neighbor] && parent[neighbor] === vertex) {
                size += sizes[neighbor];
            }
        }
        sizes[vertex] = size;
    }
    const total = vertices.length;
    for (const vertex of vertices) {
        let largest = total - sizes[vertex];
        for (const neighbor of tree.adjacency[vertex]) {
            if (!removed[neighbor] && parent[neighbor] === vertex) {
                largest = Math.max(largest, sizes[neighbor]);
            }
        }
        if (largest * 2 <= total) return vertex;
    }
    throw new RankError('could not decompose tree');
}

function collectDistances(
    tree: TreeSnapshot,
    start: number,
    parent: number,
    removed: Uint8Array,
    limit: number,
): number[] {
    const distances: number[] = [];
    const pending = [{ vertex: start, parent, distance: 1 }];
    while (pending.length > 0) {
        const current = pending.pop()!;
        if (current.distance > limit) continue;
        distances.push(current.distance);
        for (const neighbor of tree.adjacency[current.vertex]) {
            if (removed[neighbor] || neighbor === current.parent) continue;
            pending.push({
                vertex: neighbor,
                parent: current.vertex,
                distance: current.distance + 1,
            });
        }
    }
    return distances;
}

function pairsInRange(values: number[], lower: number, upper: number): number {
    values.sort((left, right) => left - right);
    return pairsAtMost(values, upper) - pairsAtMost(values, lower - 1);
}

function pairsAtMost(values: readonly number[], limit: number): number {
    let left = 0;
    let right = values.length - 1;
    let result = 0;
    while (left < right) {
        if (values[left] + values[right] <= limit) {
            result += right - left;
            left += 1;
        } else {
            right -= 1;
        }
    }
    return result;
}

function rootedTree(graph: GraphValue, root: RankValue): RankRecord {
    requireUndirected(graph, 'root');
    const rootKey = requireVertex(graph, root);
    const edgeIds = new Set<number>();
    for (const edges of graph.adjacency.values()) {
        for (const edge of edges) edgeIds.add(edge.id);
    }
    if (edgeIds.size !== graph.size - 1) {
        throw new RankError('root expects a tree');
    }

    const search = depthFirst(graph, root);
    if (search.order.length !== graph.size) {
        throw new RankError('root expects a connected tree');
    }
    const discovered = search.order;
    const discoveredAt = new Map<string, number>();
    discovered.forEach((vertex, position) => {
        discoveredAt.set(setValueKey(vertex), position);
    });
    const discoveredParent = discovered.map((_, position) => position);
    const children = discovered.map(() => [] as number[]);
    const parentValues = new Map<string, RankValue>();
    for (let position = 1; position < discovered.length; position += 1) {
        const key = setValueKey(discovered[position]);
        const value = search.parent.get(key)!;
        parentValues.set(key, value);
        const parent = discoveredAt.get(setValueKey(value))!;
        discoveredParent[position] = parent;
        children[parent].push(position);
    }
    const discoveredSizes = discovered.map(() => 1n);
    for (let position = discovered.length - 1; position > 0; position -= 1) {
        discoveredSizes[discoveredParent[position]] += discoveredSizes[position];
    }

    const heavyOrder: number[] = [];
    const heads = discovered.map(() => 0);
    const pending = [{ position: 0, head: 0 }];
    while (pending.length > 0) {
        const current = pending.pop()!;
        heavyOrder.push(current.position);
        heads[current.position] = current.head;
        const next = children[current.position];
        let heavy = -1;
        for (const child of next) {
            if (heavy < 0 || discoveredSizes[child] > discoveredSizes[heavy]) {
                heavy = child;
            }
        }
        for (let index = next.length - 1; index >= 0; index -= 1) {
            const child = next[index];
            if (child !== heavy) pending.push({ position: child, head: child });
        }
        if (heavy >= 0) pending.push({ position: heavy, head: current.head });
    }

    const vertices = heavyOrder.map(position => discovered[position]);
    const positions = new Map<string, number>();
    vertices.forEach((vertex, position) => positions.set(setValueKey(vertex), position));
    const parent = vertices.map((_, position) => position);
    const depth = vertices.map(vertex => Number(search.distance.get(setValueKey(vertex))!));
    const entries = new Map<string, RankValue>();
    const depths = new Map<string, RankValue>();
    const subtreeSizes = new Map<string, RankValue>();
    const pathHeads = new Map<string, RankValue>();
    vertices.forEach((vertex, position) => {
        const key = setValueKey(vertex);
        const original = heavyOrder[position];
        entries.set(key, BigInt(position));
        depths.set(key, BigInt(depth[position]));
        subtreeSizes.set(key, discoveredSizes[original]);
        pathHeads.set(key, discovered[heads[original]]);
        if (position > 0) {
            const value = search.parent.get(key)!;
            parent[position] = positions.get(setValueKey(value))!;
        }
    });
    const jumps = [parent];
    while (2 ** jumps.length <= Math.max(1, vertices.length)) {
        const previous = jumps.at(-1)!;
        jumps.push(previous.map(position => previous[position]));
    }
    const result = record({
        root: graph.vertices.get(rootKey)!,
        parent: indexFrom(graph, parentValues),
        depth: indexFrom(graph, depths),
        order: array(vertices),
        entry: indexFrom(graph, entries),
        size: indexFrom(graph, subtreeSizes),
        head: indexFrom(graph, pathHeads),
    });
    rootedTrees.set(result, { vertices, positions, depth, jumps });
    return result;
}

function isRootedTree(value: RankValue): value is RankRecord {
    return typeof value === 'object' && value.kind === 'record'
        && rootedTrees.has(value);
}

function expectRootedTree(value: RankValue): RootedTreeState {
    if (isRootedTree(value)) return rootedTrees.get(value)!;
    throw new RankError('operation expects a rooted tree');
}

function rootedPosition(state: RootedTreeState, value: RankValue): number {
    const position = state.positions.get(setValueKey(value));
    if (position === undefined) {
        throw new MissingValueError('rooted tree does not contain the vertex');
    }
    return position;
}

function rootedAncestor(tree: RankValue, vertex: RankValue, steps: RankValue): RankValue {
    const state = expectRootedTree(tree);
    let position = rootedPosition(state, vertex);
    if (typeof steps !== 'bigint' || steps < 0n) {
        throw new RankError('ancestor steps must be a nonnegative integer');
    }
    if (steps > BigInt(state.depth[position])) {
        throw new MissingValueError('rooted tree ancestor does not exist');
    }
    let remaining = steps;
    let level = 0;
    while (remaining > 0n) {
        if ((remaining & 1n) === 1n) position = state.jumps[level][position];
        remaining >>= 1n;
        level += 1;
    }
    return state.vertices[position];
}

function rootedLca(tree: RankValue, left: RankValue, right: RankValue): RankValue {
    const state = expectRootedTree(tree);
    let a = rootedPosition(state, left);
    let b = rootedPosition(state, right);
    if (state.depth[a] < state.depth[b]) [a, b] = [b, a];
    a = liftPosition(state, a, state.depth[a] - state.depth[b]);
    if (a === b) return state.vertices[a];
    for (let level = state.jumps.length - 1; level >= 0; level -= 1) {
        if (state.jumps[level][a] === state.jumps[level][b]) continue;
        a = state.jumps[level][a];
        b = state.jumps[level][b];
    }
    return state.vertices[state.jumps[0][a]];
}

function rootedDistance(tree: RankRecord, left: RankValue, right: RankValue): bigint {
    const state = expectRootedTree(tree);
    const a = rootedPosition(state, left);
    const b = rootedPosition(state, right);
    const common = rootedLca(tree, left, right);
    const parent = rootedPosition(state, common);
    return BigInt(state.depth[a] + state.depth[b] - 2 * state.depth[parent]);
}

function liftPosition(state: RootedTreeState, start: number, steps: number): number {
    let position = start;
    let remaining = steps;
    let level = 0;
    while (remaining > 0) {
        if (remaining % 2 === 1) position = state.jumps[level][position];
        remaining = Math.floor(remaining / 2);
        level += 1;
    }
    return position;
}

function expectFunctional(value: RankValue): RankFunctionalGraph {
    if (value instanceof RankFunctionalGraph) return value;
    throw new RankError('functional graph operation expects a functional graph');
}

function eulerTrail(graph: GraphValue, start: RankValue): RankArray {
    const startKey = requireVertex(graph, start);
    const edgeIds = new Set<number>();
    const indegree = new Map<string, number>();
    const outdegree = new Map<string, number>();
    const degree = new Map<string, number>();
    for (const key of graph.vertices.keys()) {
        indegree.set(key, 0);
        outdegree.set(key, 0);
        degree.set(key, 0);
    }
    for (const [from, edges] of graph.adjacency) {
        for (const edge of edges) {
            edgeIds.add(edge.id);
            const to = setValueKey(edge.target);
            if (graph.directed) {
                outdegree.set(from, outdegree.get(from)! + 1);
                indegree.set(to, indegree.get(to)! + 1);
            } else if (from === to) {
                degree.set(from, degree.get(from)! + 2);
            } else {
                degree.set(from, degree.get(from)! + 1);
            }
        }
    }
    if (edgeIds.size === 0) return array([start]);
    const valid = graph.directed
        ? validDirectedEuler(graph, startKey, indegree, outdegree)
        : validUndirectedEuler(graph, startKey, degree);
    if (!valid) return array([]);

    const next = new Map<string, number>();
    const used = new Set<number>();
    const stack = [startKey];
    const reversed: string[] = [];
    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        const edges = graph.adjacency.get(current) ?? [];
        let position = next.get(current) ?? 0;
        while (position < edges.length && used.has(edges[position].id)) position += 1;
        next.set(current, position);
        if (position === edges.length) {
            reversed.push(stack.pop()!);
            continue;
        }
        const edge = edges[position];
        next.set(current, position + 1);
        used.add(edge.id);
        stack.push(setValueKey(edge.target));
    }
    if (used.size !== edgeIds.size || reversed.length !== edgeIds.size + 1) {
        return array([]);
    }
    reversed.reverse();
    return array(reversed.map(key => graph.vertices.get(key)!));
}

function validDirectedEuler(
    graph: GraphValue,
    start: string,
    indegree: ReadonlyMap<string, number>,
    outdegree: ReadonlyMap<string, number>,
): boolean {
    let ends = 0;
    for (const key of graph.vertices.keys()) {
        const difference = outdegree.get(key)! - indegree.get(key)!;
        if (difference === -1) {
            ends += 1;
        } else if (difference === 1) {
            if (key !== start) return false;
        } else if (difference !== 0) {
            return false;
        }
    }
    const startDifference = outdegree.get(start)! - indegree.get(start)!;
    if (startDifference === 1) return ends === 1;
    return startDifference === 0 && ends === 0 && outdegree.get(start)! > 0;
}

function validUndirectedEuler(
    graph: GraphValue,
    start: string,
    degree: ReadonlyMap<string, number>,
): boolean {
    const odd = [...graph.vertices.keys()].filter(key => degree.get(key)! % 2 === 1);
    if (odd.length === 2) return odd.includes(start);
    return odd.length === 0 && degree.get(start)! > 0;
}

function graphCycle(graph: GraphValue): RankArray {
    const state = new Map<string, 1 | 2>();
    const parent = new Map<string, string>();
    const parentEdge = new Map<string, number>();
    for (const root of graph.vertices.keys()) {
        if (state.has(root)) continue;
        state.set(root, 1);
        const stack: Array<{ key: string; next: number }> = [{ key: root, next: 0 }];
        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const edges = graph.adjacency.get(frame.key) ?? [];
            if (frame.next >= edges.length) {
                state.set(frame.key, 2);
                stack.pop();
                continue;
            }
            const edge = edges[frame.next++];
            if (!graph.directed && parentEdge.get(frame.key) === edge.id) continue;
            const next = setValueKey(edge.target);
            if (!state.has(next)) {
                state.set(next, 1);
                parent.set(next, frame.key);
                parentEdge.set(next, edge.id);
                stack.push({ key: next, next: 0 });
                continue;
            }
            if (state.get(next) !== 1) continue;
            const keys = [next];
            let current = frame.key;
            while (current !== next) {
                keys.push(current);
                const previous = parent.get(current);
                if (previous === undefined) break;
                current = previous;
            }
            if (current !== next) continue;
            keys.push(next);
            keys.reverse();
            return array(keys.map(key => graph.vertices.get(key)!));
        }
    }
    return array([]);
}

interface ResidualEdge {
    readonly to: number;
    readonly reverse: number;
    capacity: Numeric;
}

interface OriginalFlowEdge {
    readonly from: number;
    readonly to: number;
    readonly capacity: Numeric;
    readonly residual: ResidualEdge;
}

function maximumFlowRecord(
    graph: GraphValue,
    source: RankValue,
    sink: RankValue,
): RankRecord {
    requireDirected(graph, 'maxflow');
    const sourceKey = requireVertex(graph, source);
    const sinkKey = requireVertex(graph, sink);
    const vertices = [...graph.vertices.values()];
    const position = new Map(vertices.map((value, index) => [setValueKey(value), index]));
    const start = position.get(sourceKey)!;
    const target = position.get(sinkKey)!;
    if (start === target) throw new RankError('maxflow source and sink must differ');
    const residual: ResidualEdge[][] = vertices.map(() => []);
    const originals: OriginalFlowEdge[] = [];
    for (const [fromKey, edges] of graph.adjacency) {
        const from = position.get(fromKey)!;
        for (const edge of edges) {
            validateCapacity(edge.weight);
            const to = position.get(setValueKey(edge.target))!;
            if (from === to) continue;
            const forward: ResidualEdge = {
                to, reverse: residual[to].length, capacity: edge.weight,
            };
            const reverse: ResidualEdge = {
                to: from, reverse: residual[from].length, capacity: 0n,
            };
            residual[from].push(forward);
            residual[to].push(reverse);
            originals.push({ from, to, capacity: edge.weight, residual: forward });
        }
    }

    let value: Numeric = 0n;
    while (true) {
        const levels = flowLevels(residual, start);
        if (levels[target] < 0) break;
        const next = vertices.map(() => 0);
        while (true) {
            const amount = augmentLevelPath(residual, levels, next, start, target);
            if (amount === undefined) break;
            value = numericAdd(value, amount);
        }
    }

    const flowEntries = new ResourceMap<RankValue>(item => item);
    const totals = new Map<string, Numeric>();
    for (const edge of originals) {
        const key = indexKey([vertices[edge.from], vertices[edge.to]]);
        const used = numericSubtract(edge.capacity, edge.residual.capacity);
        totals.set(key, numericAdd(totals.get(key) ?? 0n, used));
    }
    for (const [key, total] of totals) flowEntries.set(key, total);
    const flow = flowEntries.resources.track({ kind: 'index' as const, entries: flowEntries });
    return record({ value, flow, cut: reachableCut(graph, residual, vertices, start) });
}

function flowLevels(edges: readonly ResidualEdge[][], start: number): number[] {
    const levels = edges.map(() => -1);
    levels[start] = 0;
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
        const from = queue[head];
        for (const edge of edges[from]) {
            if (levels[edge.to] < 0 && numericCompare(edge.capacity, 0n) > 0) {
                levels[edge.to] = levels[from] + 1;
                queue.push(edge.to);
            }
        }
    }
    return levels;
}

function augmentLevelPath(
    edges: ResidualEdge[][],
    levels: readonly number[],
    next: number[],
    start: number,
    target: number,
): Numeric | undefined {
    const nodes = [start];
    const path: Array<{ from: number; edge: number }> = [];
    while (nodes.length > 0) {
        const from = nodes[nodes.length - 1];
        if (from === target) {
            let amount = edges[path[0].from][path[0].edge].capacity;
            for (const step of path.slice(1)) {
                const capacity = edges[step.from][step.edge].capacity;
                if (numericCompare(capacity, amount) < 0) amount = capacity;
            }
            for (const step of path) {
                const edge = edges[step.from][step.edge];
                edge.capacity = numericSubtract(edge.capacity, amount);
                const reverse = edges[edge.to][edge.reverse];
                reverse.capacity = numericAdd(reverse.capacity, amount);
            }
            return amount;
        }
        let advanced = false;
        while (next[from] < edges[from].length) {
            const edge = edges[from][next[from]];
            if (levels[edge.to] === levels[from] + 1
                && numericCompare(edge.capacity, 0n) > 0) {
                path.push({ from, edge: next[from] });
                nodes.push(edge.to);
                advanced = true;
                break;
            }
            next[from] += 1;
        }
        if (advanced) continue;
        nodes.pop();
        const previous = path.pop();
        if (previous) next[previous.from] += 1;
    }
    return undefined;
}

function reachableCut(
    graph: GraphValue,
    edges: readonly ResidualEdge[][],
    vertices: readonly RankValue[],
    start: number,
): RankValue {
    const seen = new Set([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
        for (const edge of edges[queue[head]]) {
            if (!seen.has(edge.to) && numericCompare(edge.capacity, 0n) > 0) {
                seen.add(edge.to);
                queue.push(edge.to);
            }
        }
    }
    return setFrom(graph, new Set([...seen].map(index => setValueKey(vertices[index]))));
}

function validateCapacity(value: Numeric): void {
    if (numericCompare(value, 0n) < 0
        || (typeof value === 'number' && !Number.isFinite(value))) {
        throw new RankError('maxflow requires finite nonnegative capacities');
    }
}

function expectDsu(value: RankValue): RankDsu {
    if (isRankDsu(value)) return value;
    throw new RankError('dsu operation expects a dsu');
}

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

function numericSubtract(left: Numeric, right: Numeric): Numeric {
    return typeof left === 'number' || typeof right === 'number'
        ? Number(left) - Number(right)
        : left - right;
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
