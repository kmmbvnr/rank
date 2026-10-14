import { MissingValueError, RankError } from './errors.js';
import type { GraphValue } from './graph.js';
import { checkpoint } from './interrupt.js';
import { sequence } from './sequence.js';
import { setValueKey } from './set.js';
import { isRankLabel, type RankValue } from './value.js';

function vertexKey(value: RankValue): string {
    if (typeof value === 'bigint' || typeof value === 'number'
        || typeof value === 'boolean' || typeof value === 'string'
        || isRankLabel(value)) return setValueKey(value);
    throw new RankError('graph vertices must be scalar values');
}

/** A vertex route identifies a connection, not a particular parallel edge. */
export function edgeWeight(graph: GraphValue, from: RankValue, to: RankValue): RankValue {
    const fromKey = vertexKey(from);
    const toKey = vertexKey(to);
    let weight: bigint | number | undefined;
    for (const edge of graph.adjacency.get(fromKey) ?? []) {
        checkpoint('looking up graph edge');
        if (vertexKey(edge.target) === toKey && (weight === undefined || edge.weight < weight)) {
            weight = edge.weight;
        }
    }
    if (weight === undefined) throw new MissingValueError('graph does not contain the connection');
    return weight;
}

/** Snapshot adjacency eagerly; enumerate simple routes only as demanded. */
export function trips(graph: GraphValue, from: RankValue, to: RankValue, stops: RankValue): RankValue {
    if (typeof stops !== 'bigint' || stops < 0n) {
        throw new RankError('trips expects a nonnegative integer stop limit');
    }
    const start = vertexKey(from);
    const target = vertexKey(to);
    if (!graph.open && (!graph.vertices.has(start) || !graph.vertices.has(target))) {
        throw new MissingValueError('graph does not contain the trip endpoint');
    }
    const adjacency = new Map<string, string[]>();
    const vertices = new Map(graph.vertices);
    for (const [key, edges] of graph.adjacency) {
        const neighbors = new Set<string>();
        for (const edge of edges) {
            checkpoint('preparing trips');
            neighbors.add(vertexKey(edge.target));
        }
        adjacency.set(key, [...neighbors]);
    }
    const maxEdges = Number(stops < BigInt(vertices.size) ? stops + 1n : BigInt(vertices.size));
    return sequence({
        name: 'graph trips',
        size: { kind: 'unknown' },
        *iterate() {
            if (start === target || !vertices.has(start) || !vertices.has(target)) return;
            const path = [start];
            const visited = new Set(path);
            const next = [0];
            while (path.length) {
                checkpoint('enumerating trips');
                const depth = path.length - 1;
                const neighbors = adjacency.get(path[depth])!;
                if (depth >= maxEdges || next[depth] >= neighbors.length) {
                    visited.delete(path.pop()!);
                    next.pop();
                    continue;
                }
                const neighbor = neighbors[next[depth]++];
                if (visited.has(neighbor)) continue;
                if (neighbor === target) {
                    const items = [...path, neighbor].map(key => vertices.get(key)!);
                    yield { kind: 'array', items, shape: [items.length] };
                } else {
                    path.push(neighbor);
                    visited.add(neighbor);
                    next.push(0);
                }
            }
        },
    });
}
