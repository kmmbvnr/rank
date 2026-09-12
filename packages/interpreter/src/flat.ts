import { ResourceSummary } from './resource-summary.js';
import { MissingValueError, RankError } from './errors.js';
import { isRankArray, isRankRecord, type RankPlainArray, type RankRecord, type RankValue } from './value.js';

type FieldType = 'integer' | 'real' | 'boolean';

/** Fixed-width records, interleaved in a single buffer. Reads are value copies. */
export class FlatRecords implements RankPlainArray {
    readonly kind = 'array' as const;
    readonly containsFiles = false as const;
    readonly shape: readonly number[];
    readonly fields: readonly (readonly [string, FieldType])[];
    readonly stride: number;
    private readonly data: DataView;

    constructor(count: number, state: RankRecord, initialize = true) {
        if (!Number.isSafeInteger(count) || count < 0) throw new RankError('flat size must be a nonnegative safe integer');
        new ResourceSummary(() => true).track(this);
        this.shape = [count];
        this.fields = [...state.entries].map(([name, value]) => {
            const type = typeof value === 'bigint' ? 'integer'
                : typeof value === 'number' ? 'real' : typeof value === 'boolean' ? 'boolean' : undefined;
            if (!type) throw new RankError(`flat field .${name} must be integer, real or boolean`);
            return [name, type] as const;
        });
        this.stride = this.fields.length * 8;
        this.data = new DataView(new ArrayBuffer(count * this.stride));
        this.validate(state);
        if (initialize && count > 0) {
            this.set(0, state);
            const bytes = new Uint8Array(this.data.buffer);
            // Repeat the first encoded record by doubling the initialized range.
            for (let filled = this.stride; filled > 0 && filled < bytes.length; filled *= 2) {
                bytes.copyWithin(filled, 0, Math.min(filled, bytes.length - filled));
            }
        }
    }

    get byteLength(): number { return this.data.byteLength; }
    get items(): RankValue[] { return Array.from({ length: this.shape[0] }, (_, i) => this.itemAt(i)); }

    private position(index: number): number {
        if (!Number.isInteger(index) || index < 0 || index >= this.shape[0]) {
            throw new MissingValueError(`flat index out of bounds: ${index}`);
        }
        return index * this.stride;
    }

    itemAt(index: number): RankRecord {
        const start = this.position(index);
        const entries = new Map<string, RankValue>();
        this.fields.forEach(([name, type], field) => {
            const offset = start + field * 8;
            entries.set(name, type === 'integer' ? this.data.getBigInt64(offset, true)
                : type === 'real' ? this.data.getFloat64(offset, true) : this.data.getUint8(offset) !== 0);
        });
        return { kind: 'record', entries, types: new Map(this.fields) };
    }

    validate(value: RankValue): RankRecord {
        if (!isRankRecord(value) || value.entries.size !== this.fields.length) {
            throw new RankError('flat expects a record with the same fields');
        }
        for (const [name, type] of this.fields) {
            const field = value.entries.get(name);
            const expected = type === 'integer' ? 'bigint' : type === 'real' ? 'number' : 'boolean';
            if (typeof field !== expected) throw new RankError(`flat field .${name} expects ${type}`);
            if (typeof field === 'bigint' && (field < -(1n << 63n) || field >= (1n << 63n))) {
                throw new RankError(`flat field .${name} exceeds signed 64-bit integer range`);
            }
        }
        return value;
    }

    set(index: number, value: RankValue): void {
        const start = this.position(index);
        const record = this.validate(value);
        this.fields.forEach(([name, type], field) => {
            const offset = start + field * 8;
            const item = record.entries.get(name)!;
            if (type === 'integer') this.data.setBigInt64(offset, item as bigint, true);
            else if (type === 'real') this.data.setFloat64(offset, item as number, true);
            else this.data.setUint8(offset, item ? 1 : 0);
        });
    }

    /** Runtime-owned storage with the same layout; ArrayBuffer is zero-filled. */
    emptyLike(count: number): FlatRecords {
        const state: RankRecord = { kind: 'record', entries: new Map(this.fields.map(([name, type]) =>
            [name, type === 'integer' ? 0n : type === 'real' ? 0 : false])), types: new Map(this.fields) };
        return new FlatRecords(count, state, false);
    }

    /** Internal callers prove matching layouts and valid ranges. */
    copySlots(source: FlatRecords, from: number, to: number, count = 1): void {
        new Uint8Array(this.data.buffer, to * this.stride, count * this.stride)
            .set(new Uint8Array(source.data.buffer, from * source.stride, count * source.stride));
    }

    readIntegers(index: number, output: bigint[]): void {
        const start = index * this.stride;
        for (let field = 0; field < this.fields.length; field++) {
            output[field] = this.data.getBigInt64(start + field * 8, true);
        }
    }

    writeIntegers(index: number, values: bigint[]): void {
        for (let field = 0; field < this.fields.length; field++) {
            if (values[field] < -(1n << 63n) || values[field] >= (1n << 63n)) {
                throw new RankError(`flat field .${this.fields[field][0]} exceeds signed 64-bit integer range`);
            }
        }
        const start = index * this.stride;
        for (let field = 0; field < this.fields.length; field++) {
            this.data.setBigInt64(start + field * 8, values[field], true);
        }
    }

    integerRecord(values: bigint[], order?: readonly string[]): RankRecord {
        const names = order ?? this.fields.map(([name]) => name);
        return { kind: 'record', entries: new Map(names.map(name =>
            [name, values[this.fields.findIndex(([field]) => field === name)]])),
            types: new Map(names.map(name => [name, 'integer'])) };
    }

    copy(): FlatRecords {
        const result = this.emptyLike(this.shape[0]);
        result.copySlots(this, 0, 0, this.shape[0]);
        return result;
    }

}

export function flatRecords(values: RankValue[]): FlatRecords {
    if (values.length === 2) {
        const [count, state] = values;
        if (typeof count !== 'bigint' || count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER) || !isRankRecord(state)) {
            throw new RankError('flat expects a nonnegative count and a record state');
        }
        return new FlatRecords(Number(count), state);
    }
    const source = values[0];
    if (source instanceof FlatRecords) return source.copy();
    if (!isRankArray(source) || source.shape.length !== 1 || source.shape[0] === 0) {
        throw new RankError('flat expects a nonempty rank-1 record array; use Count State flat for empty arrays');
    }
    const read = (i: number) => source.itemAt?.(i) ?? source.items[i];
    const state = read(0);
    if (!isRankRecord(state)) throw new RankError('flat expects record values');
    const result = new FlatRecords(source.shape[0], state, false);
    for (let i = 0; i < source.shape[0]; i++) result.set(i, read(i));
    return result;
}
