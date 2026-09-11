import { MissingValueError, RankError } from './errors.js';
import { ResourceMap } from './resource-summary.js';
import {
    isRankArray,
    type RankArray,
    type RankRecord,
    type RankValue,
} from './value.js';

type Numeric = bigint | number;

/** A prepared successor graph over the integer vertices 1 through N. */
export class RankFunctionalGraph {
    readonly kind = 'functional' as const;
    private readonly next: number[];
    private readonly jumps: number[][];
    private readonly component: number[];
    private readonly depth: number[];
    private readonly entry: number[];
    private readonly cyclePosition: number[];
    private readonly cycleLength: number[];
    private readonly increasing: boolean;
    private readonly weightJumps?: Numeric[][];

    constructor(value: RankValue, weights?: RankValue) {
        this.next = successorArray(value);
        this.jumps = [this.next];
        this.weightJumps = weights === undefined
            ? undefined : [weightArray(weights, this.next.length)];
        this.increasing = this.next.every((next, from) =>
            next === from || next > from);
        const structure = decompose(this.next);
        this.component = structure.component;
        this.depth = structure.depth;
        this.entry = structure.entry;
        this.cyclePosition = structure.cyclePosition;
        this.cycleLength = structure.cycleLength;
    }

    get size(): number { return this.next.length; }

    jump(start: RankValue, steps: RankValue): bigint {
        let vertex = this.vertex(start);
        let remaining = nonnegativeInteger(steps, 'functional jump steps');
        let level = 0;
        while (remaining > 0n) {
            if ((remaining & 1n) === 1n) {
                this.ensureLevel(level);
                vertex = this.jumps[level][vertex];
            }
            remaining >>= 1n;
            level += 1;
        }
        return BigInt(vertex + 1);
    }

    distance(from: RankValue, to: RankValue): bigint {
        const start = this.vertex(from);
        const target = this.vertex(to);
        if (this.component[start] !== this.component[target]) {
            throw new MissingValueError('functional graph target is unreachable');
        }
        if (this.depth[target] > 0) {
            const difference = this.depth[start] - this.depth[target];
            if (difference < 0
                || this.jumpIndex(start, BigInt(difference)) !== target) {
                throw new MissingValueError('functional graph target is unreachable');
            }
            return BigInt(difference);
        }
        const firstCycleVertex = this.entry[start];
        const length = this.cycleLength[start];
        const around = (this.cyclePosition[target]
            - this.cyclePosition[firstCycleVertex] + length) % length;
        return BigInt(this.depth[start] + around);
    }

    lengths(): RankArray {
        const items = this.depth.map((depth, vertex) =>
            BigInt(depth + this.cycleLength[vertex]));
        return { kind: 'array', items, shape: [items.length] };
    }

    upto(start: RankValue, limit: RankValue): RankValue {
        let vertex = this.vertex(start);
        const bound = nonnegativeInteger(
            limit, 'functional upto limit',
        );
        if (BigInt(vertex + 1) > bound) {
            return this.weightJumps
                ? stateRecord(0n, 0n, vertex) : 0n;
        }
        if (!this.increasing) {
            throw new RankError(
                'upto requires increasing successors',
            );
        }

        let level = 0;
        while (2 ** level <= this.size) {
            this.ensureLevel(level);
            level += 1;
        }
        let count = 1n;
        let sum: Numeric = 0n;
        for (level -= 1; level >= 0; level -= 1) {
            const steps = 2 ** level;
            const candidate = this.jumps[level][vertex];
            if (steps <= this.depth[vertex]
                && BigInt(candidate + 1) <= bound) {
                if (this.weightJumps) {
                    sum = numericAdd(
                        sum,
                        this.weightJumps[level][vertex],
                    );
                }
                vertex = candidate;
                count += 1n << BigInt(level);
            }
        }
        if (!this.weightJumps) return count;
        return stateRecord(count, sum, vertex);
    }

    private vertex(value: RankValue): number {
        const vertex = nonnegativeInteger(value, 'functional graph vertex');
        if (vertex < 1n || vertex > BigInt(this.size)) {
            throw new MissingValueError('functional graph does not contain the vertex');
        }
        return Number(vertex - 1n);
    }

    private jumpIndex(start: number, steps: bigint): number {
        let vertex = start;
        let remaining = steps;
        let level = 0;
        while (remaining > 0n) {
            if ((remaining & 1n) === 1n) {
                this.ensureLevel(level);
                vertex = this.jumps[level][vertex];
            }
            remaining >>= 1n;
            level += 1;
        }
        return vertex;
    }

    private ensureLevel(level: number): void {
        while (this.jumps.length <= level) {
            const previous = this.jumps.at(-1)!;
            this.jumps.push(previous.map(vertex => previous[vertex]));
            if (this.weightJumps) {
                const weights = this.weightJumps.at(-1)!;
                this.weightJumps.push(weights.map(
                    (weight, vertex) => numericAdd(
                        weight,
                        weights[previous[vertex]],
                    ),
                ));
            }
        }
    }
}

function stateRecord(
    count: bigint,
    sum: Numeric,
    vertex: number,
): RankRecord {
    const entries = new ResourceMap<RankValue>(value => value);
    entries.set('count', count);
    entries.set('sum', sum);
    entries.set('last', BigInt(vertex + 1));
    const types = new Map([
        ['count', 'integer'],
        ['sum', typeof sum === 'bigint' ? 'integer' : 'real'],
        ['last', 'integer'],
    ]);
    return entries.resources.track({
        kind: 'record', entries, types,
    });
}

function numericAdd(left: Numeric, right: Numeric): Numeric {
    if (typeof left === 'bigint' && typeof right === 'bigint') {
        return left + right;
    }
    return Number(left) + Number(right);
}

interface FunctionalStructure {
    readonly component: number[];
    readonly depth: number[];
    readonly entry: number[];
    readonly cyclePosition: number[];
    readonly cycleLength: number[];
}

function decompose(next: readonly number[]): FunctionalStructure {
    const indegree = next.map(() => 0);
    for (const target of next) indegree[target] += 1;
    const queue: number[] = [];
    for (let vertex = 0; vertex < next.length; vertex += 1) {
        if (indegree[vertex] === 0) queue.push(vertex);
    }
    const removed: number[] = [];
    for (let head = 0; head < queue.length; head += 1) {
        const vertex = queue[head];
        removed.push(vertex);
        const target = next[vertex];
        indegree[target] -= 1;
        if (indegree[target] === 0) queue.push(target);
    }

    const component = next.map(() => -1);
    const depth = next.map(() => 0);
    const entry = next.map(() => -1);
    const cyclePosition = next.map(() => -1);
    const cycleLength = next.map(() => 0);
    let componentCount = 0;
    for (let root = 0; root < next.length; root += 1) {
        if (indegree[root] === 0 || component[root] >= 0) continue;
        const cycle: number[] = [];
        let vertex = root;
        do {
            cycle.push(vertex);
            vertex = next[vertex];
        } while (vertex !== root);
        for (let position = 0; position < cycle.length; position += 1) {
            const member = cycle[position];
            component[member] = componentCount;
            entry[member] = member;
            cyclePosition[member] = position;
            cycleLength[member] = cycle.length;
        }
        componentCount += 1;
    }
    for (let index = removed.length - 1; index >= 0; index -= 1) {
        const vertex = removed[index];
        const target = next[vertex];
        component[vertex] = component[target];
        depth[vertex] = depth[target] + 1;
        entry[vertex] = entry[target];
        cyclePosition[vertex] = cyclePosition[target];
        cycleLength[vertex] = cycleLength[target];
    }
    return { component, depth, entry, cyclePosition, cycleLength };
}

function successorArray(value: RankValue): number[] {
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError('functional expects a rank-1 successor array');
    }
    const size = value.shape[0];
    if (size === 0) throw new RankError('functional graph cannot be empty');
    return Array.from({ length: size }, (_, index) => {
        const item = value.itemAt?.(index) ?? value.items[index];
        if (typeof item !== 'bigint' || item < 1n || item > BigInt(size)) {
            throw new RankError('functional successors must be integers from 1 to N');
        }
        return Number(item - 1n);
    });
}

function weightArray(value: RankValue, size: number): Numeric[] {
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError('weighted expects a rank-1 weight array');
    }
    if (value.shape[0] !== size) {
        throw new RankError('weighted successors and weights must have equal length');
    }
    return Array.from({ length: size }, (_, index) => {
        const item = value.itemAt?.(index) ?? value.items[index];
        if (typeof item !== 'bigint' && typeof item !== 'number') {
            throw new RankError('weighted requires numeric weights');
        }
        return item;
    });
}

function nonnegativeInteger(value: RankValue, name: string): bigint {
    if (typeof value !== 'bigint' || value < 0n) {
        throw new RankError(`${name} must be a nonnegative integer`);
    }
    return value;
}
