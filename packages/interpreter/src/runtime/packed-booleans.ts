import { popcountWord } from './bitmap.js';
import { BooleanCells } from './boolean-cells.js';
import { ownedStorage } from './array-storage-state.js';
import { createOwned } from './owned-array.js';
import { checkpoint, inspectionEnabled } from '../interrupt.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

interface BitReader {
    readonly length: number;
    readonly physical?: { words: Uint32Array; offset: number; period?: number };
    wordAt(index: number): number;
    countAt?(start: number, length: number): bigint | undefined;
    validate?(): void;
}
interface BitPlan {
    readonly reader: RankArray['itemAt'];
    readonly shape: readonly number[];
    prepare(): BitReader | undefined;
}
const plans = new WeakMap<RankArray, BitPlan>();

/** Completed operands may execute eagerly, as ordinary stored boolean maps do. */
export function mapPackedBooleanArrays(left: RankArray, right?: RankArray, operator = 'not'): RankArray | undefined {
    const a = ownedStorage.get(left), b = right && ownedStorage.get(right);
    if (inspectionEnabled() || !a?.stable || !a.booleans || right && (!b?.stable || !b.booleans
        || left.shape.length !== right.shape.length || left.shape.some((size, axis) => size !== right.shape[axis]))) return undefined;
    const cells = new BooleanCells(a.booleans.length);
    for (let i = 0; i < cells.words.length; i++) {
        if ((i & 127) === 0) checkpoint('combining boolean words', Math.min(4096, cells.length - i * 32));
        const x = a.booleans.words[i], y = b?.booleans?.words[i] ?? 0;
        cells.words[i] = operator === 'not' ? ~x : operator === 'and' ? x & y : operator === 'or' ? x | y : x ^ y;
    }
    cells.trim();
    return createOwned(cells, left.shape, true);
}

/** No cell reads, speculative packing, or cached values. A live native recipe
 * is resolved again at every demand, including after host writes. */
function bitReader(value: RankArray): BitReader | undefined {
    if (inspectionEnabled()) return undefined;
    const stored = ownedStorage.get(value);
    if (stored?.stable && stored.booleans && value.itemAt === undefined
        && value.shape.reduce((n, axis) => n * axis, 1) === stored.booleans.length) {
        const cells = stored.booleans;
        return { length: cells.length, physical: { words: cells.words, offset: 0 }, wordAt: index => cells.words[index] ?? 0 };
    }
    const plan = plans.get(value);
    if (!plan || plan.reader !== value.itemAt || plan.shape.length !== value.shape.length
        || plan.shape.some((size, axis) => size !== value.shape[axis])) return undefined;
    return plan.prepare();
}

function register(value: RankArray, prepare: BitPlan['prepare']): void {
    plans.set(value, { reader: value.itemAt, shape: [...value.shape], prepare });
}

/** Binding checks depend on the scalar domain. A nonempty boolean bitmap has
 * one uniform domain, so its internal contract can be established once without
 * reading or unpacking any cells. Empty arrays establish no element contract. */
export function registerPackedBooleanCheck(value: RankArray, source: RankArray, validate: (cell: RankValue) => RankValue): void {
    if (source.columnNames) return;
    register(value, () => {
        const input = bitReader(source);
        if (input?.length) {
            // Prepared readers belong to this demand; keep checks deferred until
            // a consumer actually reads cells (empty slices read none).
            const previous = input.validate;
            input.validate = () => { previous?.(); validate(false); };
        }
        return input;
    });
}

/** Read 32 logical bits at an arbitrary offset, with zero outside the source. */
function boundedWord(source: BitReader, index: number): number {
    if (index < 0 || index * 32 >= source.length) return 0;
    const remaining = source.length - index * 32;
    return source.wordAt(index) & (remaining < 32 ? 0xffffffff >>> (32 - remaining) : 0xffffffff);
}

function readBits(source: BitReader, offset: number): number {
    const word = Math.floor(offset / 32), shift = offset - word * 32;
    return (shift === 0 ? boundedWord(source, word)
        : (boundedWord(source, word) >>> shift) | (boundedWord(source, word + 1) << (32 - shift))) >>> 0;
}

function physicalWord(words: Uint32Array, offset: number): number {
    const word = Math.floor(offset / 32), shift = offset % 32;
    return shift === 0 ? words[word] : (words[word] >>> shift) | ((words[word + 1] ?? 0) << (32 - shift));
}

/** Flat word loads for an entire reduction cell. Resolve views and contracts
 * once per cell, keeping them out of the inner word loop. */
function countPhysical(operator: string, a: BitReader, b: BitReader | undefined, start: number, length: number): bigint | undefined {
    const left = a.physical, right = b?.physical;
    if (!left || b && !right) return undefined;
    const leftAt = left.period ? start % left.period : start;
    const rightAt = right?.period ? start % right.period : start;
    if (left.period && leftAt + length > left.period || right?.period && rightAt + length > right.period) return undefined;
    const xWords = left.words, yWords = right?.words;
    const xStart = left.offset + leftAt, yStart = (right?.offset ?? 0) + rightAt;
    let count = 0;
    for (let offset = 0; offset < length; offset += 32) {
        if ((offset & 4095) === 0) checkpoint('counting boolean words', Math.min(4096, length - offset));
        const x = physicalWord(xWords, xStart + offset), y = yWords ? physicalWord(yWords, yStart + offset) : 0;
        const word = operator === 'and' ? x & y : operator === 'or' ? x | y
            : operator === 'xor' ? x ^ y : operator === 'not' ? ~x : x;
        const remaining = length - offset;
        count += popcountWord(word & (remaining < 32 ? 0xffffffff >>> (32 - remaining) : 0xffffffff));
    }
    return BigInt(count);
}

export function registerPackedBooleanMap(value: RankArray, operator: string, operands: readonly RankValue[]): void {
    if (!['and', 'or', 'xor', 'not'].includes(operator)) return;
    const matches = (operand: RankArray) => operand.shape.length === value.shape.length
        && operand.shape.every((size, axis) => size === value.shape[axis]);
    const rowBroadcast = (operand: RankArray) => value.shape.length === 2
        && (operand.shape.length === 1 || operand.shape.length === 2 && operand.shape[0] === 1)
        && operand.shape[operand.shape.length - 1] === value.shape[1];
    if (!operands.every(operand => typeof operand === 'boolean' || isRankArray(operand)
        && (matches(operand) || rowBroadcast(operand)))) return;
    register(value, () => {
        const length = value.shape.reduce((a, b) => a * b, 1);
        const inputs = operands.map(operand => {
            if (typeof operand === 'boolean') return { length, wordAt: () => operand ? 0xffffffff : 0 };
            const array = operand as RankArray, input = bitReader(array);
            if (!input || matches(array)) return input;
            if (!rowBroadcast(array)) return undefined;
            // Repeat the logical row, including when words cross row boundaries.
            return { length, validate: input.validate, physical: input.physical && { ...input.physical, period: input.length }, wordAt: (index: number) => {
                let result = 0, filled = 0, position = index * 32 % input.length;
                while (filled < 32) {
                    const take = Math.min(32 - filled, input.length - position);
                    const mask = take === 32 ? 0xffffffff : 0xffffffff >>> (32 - take);
                    result |= (readBits(input, position) & mask) << filled;
                    filled += take;
                    position = 0;
                }
                return result;
            } };
        });
        if (inputs.some(input => !input)) return undefined;
        const [a, b] = inputs as BitReader[];
        return { length, validate: () => { if (length) for (const input of inputs) input!.validate?.(); },
            countAt: (start, size) => countPhysical(operator, a, b, start, size), wordAt: index => {
            const x = a.wordAt(index);
            return operator === 'not' ? ~x : operator === 'and' ? x & b.wordAt(index)
                : operator === 'or' ? x | b.wordAt(index) : x ^ b.wordAt(index);
        } };
    });
}

export function registerPackedBooleanShift(value: RankArray, source: RankArray, amount: number, fill: RankValue, axis: number): void {
    if (source.shape.length !== 1 || axis !== 0 || fill !== false) return;
    register(value, () => {
        if (Math.abs(amount) >= source.shape[0]) return { length: source.shape[0], wordAt: () => 0 };
        const input = bitReader(source);
        return input && { length: input.length, validate: input.validate, wordAt: index => readBits(input, index * 32 - amount) };
    });
}

/** Contiguous rows retain the existing live selection and COW behavior. The
 * source and offset callbacks follow a selection detached by a later write. */
export function registerPackedBooleanSelection(value: RankArray, source: () => RankArray, offset: () => number | undefined): void {
    register(value, () => {
        const start = offset(), input = bitReader(source());
        if (start === undefined || !input) return undefined;
        const length = value.shape.reduce((a, b) => a * b, 1);
        return { length, validate: length ? input.validate : undefined, physical: input.physical && !input.physical.period
            ? { words: input.physical.words, offset: input.physical.offset + start } : undefined,
            wordAt: index => readBits(input, start + index * 32) };
    });
}

export function materializePackedBooleans(value: RankArray): RankArray | undefined {
    const input = bitReader(value);
    if (!input) return undefined;
    if (input.length) input.validate?.();
    const cells = new BooleanCells(input.length);
    for (let i = 0; i < cells.words.length; i++) {
        if ((i & 127) === 0) checkpoint('materializing boolean words', Math.min(4096, input.length - i * 32));
        cells.words[i] = input.wordAt(i);
    }
    cells.trim();
    return createOwned(cells, value.shape, true, value.columnNames, undefined,
        { tableScopes: value.tableScopes, sortKeys: value.sortKeys });
}

export function countPackedBooleans(value: RankArray): bigint | undefined {
    return countPackedBooleanRange(value, 0, value.shape.reduce((a, b) => a * b, 1));
}

/** A contiguous reduction cell can start between physical word boundaries. */
export function countPackedBooleanRange(value: RankArray, start: number, length: number): bigint | undefined {
    const input = bitReader(value);
    if (!input) return undefined;
    if (length) input.validate?.();
    const direct = input.countAt?.(start, length) ?? countPhysical('identity', input, undefined, start, length);
    if (direct !== undefined) return direct;
    let count = 0;
    for (let offset = 0; offset < length; offset += 32) {
        if ((offset & 4095) === 0) checkpoint('counting boolean words', Math.min(4096, length - offset));
        const remaining = length - offset;
        const word = readBits(input, start + offset);
        count += popcountWord(word & (remaining < 32 ? 0xffffffff >>> (32 - remaining) : 0xffffffff));
    }
    return BigInt(count);
}

export function packedTruePositions(value: RankArray): number[] | undefined {
    const input = bitReader(value);
    if (!input) return undefined;
    if (input.length) input.validate?.();
    const positions: number[] = [];
    for (let i = 0; i < Math.ceil(input.length / 32); i++) {
        if ((i & 127) === 0) checkpoint('finding boolean indices', Math.min(4096, input.length - i * 32));
        let word = boundedWord(input, i);
        while (word) {
            const bit = 31 - Math.clz32(word & -word);
            positions.push(i * 32 + bit);
            word = (word & (word - 1)) >>> 0;
        }
    }
    return positions;
}
