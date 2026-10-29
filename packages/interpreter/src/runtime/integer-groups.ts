import { MissingValueError, RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { ResourceSummary } from '../resource-summary.js';
import { checkValueMutable } from './value-protection.js';
import { registerStoredSequence } from './stored-value.js';
import { sequence } from '../sequence.js';
import type { RankSequence } from './value.js';

const CHUNK_SIZE = 65536;
const MAX_SLOT = 0xFFFFFFFF;
const MIN_INT64 = -(1n << 63n), MAX_INT64 = (1n << 63n) - 1n;

interface Chunk {
    readonly values: BigInt64Array;
    readonly next: Uint32Array;
}

const emptyGroup = sequence({
    name: 'integer group', replay: 'direct', size: { kind: 'exact', value: 0n },
    *iterate() {},
});
registerStoredSequence(emptyGroup.plan);
new ResourceSummary(() => true).track(emptyGroup);

/** Append-only integer groups. Zero links represent empty groups; no group
 * owns a container. Chunked value storage never copies earlier insertions. */
export class RankIntegerGroups {
    readonly kind = 'groups' as const;
    readonly size: number;
    private readonly heads: Uint32Array;
    private readonly tails: Uint32Array;
    private readonly chunks: Chunk[] = [];
    private wideValues?: Map<number, bigint>;
    private count = 0;

    constructor(size: bigint) {
        if (size < 0n || size > BigInt(MAX_SLOT)) {
            throw new RankError(`groups size must be between 0 and ${MAX_SLOT}`);
        }
        this.size = Number(size);
        this.heads = new Uint32Array(this.size);
        this.tails = new Uint32Array(this.size);
        new ResourceSummary(() => true).track(this);
    }

    /** Typed buffers only; does not include exceptional arbitrary-size values. */
    get storageBytes(): number {
        return this.heads.byteLength + this.tails.byteLength
            + this.chunks.length * CHUNK_SIZE * 12;
    }

    insert(key: bigint, value: bigint): this {
        checkValueMutable(this);
        const group = this.position(key);
        if (this.count === MAX_SLOT) throw new RankError('groups contain too many values');
        const slot = this.count;
        const offset = slot % CHUNK_SIZE;
        if (offset === 0) {
            this.chunks.push({ values: new BigInt64Array(CHUNK_SIZE), next: new Uint32Array(CHUNK_SIZE) });
        }
        const chunk = this.chunks[Math.floor(slot / CHUNK_SIZE)];
        if (value < MIN_INT64 || value > MAX_INT64) {
            (this.wideValues ??= new Map()).set(slot, value);
        } else chunk.values[offset] = value;
        const previous = this.tails[group];
        if (previous === 0) this.heads[group] = slot + 1;
        else {
            const index = previous - 1;
            this.chunks[Math.floor(index / CHUNK_SIZE)].next[index % CHUNK_SIZE] = slot + 1;
        }
        this.tails[group] = slot + 1;
        this.count++;
        return this;
    }

    /** Appends never replace values. Stopping at the captured last slot makes
     * this finite source immutable, without copying its values. */
    at(key: bigint): RankSequence {
        const group = this.position(key), first = this.heads[group], last = this.tails[group];
        if (first === 0) return emptyGroup;
        const storage = this;
        const result = sequence({
            name: 'integer group', replay: 'direct',
            size: { kind: 'unknown' },
            *iterate() {
                let link = first;
                while (link !== 0) {
                    checkpoint('reading integer groups');
                    const slot = link - 1, offset = slot % CHUNK_SIZE;
                    const chunk = storage.chunks[Math.floor(slot / CHUNK_SIZE)];
                    yield storage.wideValues?.get(slot) ?? chunk.values[offset];
                    if (link === last) break;
                    link = chunk.next[offset];
                }
            },
        });
        registerStoredSequence(result.plan);
        new ResourceSummary(() => true).track(result);
        return result;
    }

    private position(key: bigint): number {
        if (key < 0n || key >= BigInt(this.size)) {
            throw new MissingValueError(`groups key out of bounds: ${key}`);
        }
        return Number(key);
    }
}
