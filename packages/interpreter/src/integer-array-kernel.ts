import { DENSE_MIN_CELLS } from './tensor-operands.js';
import { BooleanCells } from './boolean-cells.js';
import { createOwned } from './owned-array.js';
import { booleanCells, IntegerCells, ownedScalarArray, typedArray } from './array-storage.js';
import { greatestCommonDivisor, safeIntegerGcd } from './integer-gcd.js';
import { RankError } from './errors.js';
import { prepareIntegerView, prepareStoredScalarView } from './integer-view.js';
import { checkpoint, inspectionEnabled, InterruptedError, privateLoopPolling } from './interrupt.js';
import { floorDivide, floorRemainder } from './numeric-division.js';
import { arrayStrides, broadcastOffset, broadcastShape, trailingCells } from './tensor-layout.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

const lowWord = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;

/** Exact arithmetic over stored integers, including trusted segmented views.
 * Borrowed readers live only during this callback-free synchronous pass. */
export function mapStoredIntegers(left: RankValue, right: RankValue, name?: string): RankArray | undefined {
    const operation = name === '+' ? (a: bigint, b: bigint) => a + b
        : name === '-' ? (a: bigint, b: bigint) => a - b
        : name === '*' ? (a: bigint, b: bigint) => a * b
        : name === 'mod' ? floorRemainder : name === '//' ? floorDivide
        : name === 'min' ? (a: bigint, b: bigint) => b < a ? b : a
        : name === 'max' ? (a: bigint, b: bigint) => b > a ? b : a
        : name === 'gcd' ? greatestCommonDivisor
        : name === 'abs' ? (a: bigint) => a < 0n ? -a : a : undefined;
    if (!operation || inspectionEnabled() || !privateLoopPolling()) return undefined;
    if (name === '+' || name === '-' || name === '*' || name === 'gcd') {
        try {
            const compact = mapStoredInt32Binary(left, right, name);
            if (compact) return compact;
        } catch (error) {
            if (error instanceof InterruptedError) throw error;
            if (!(error instanceof RankError)) throw error;
        }
    }
    const a = isRankArray(left) ? prepareIntegerView(left, true) : undefined;
    const b = isRankArray(right) ? prepareIntegerView(right, true) : undefined;
    if (isRankArray(left) ? !a?.regular : typeof left !== 'bigint') return undefined;
    if (isRankArray(right) ? !b?.regular : typeof right !== 'bigint') return undefined;
    if (!a && !b) return undefined;
    const shape = broadcastShape(a?.shape ?? [], b?.shape ?? []);
    const ai = broadcastIndex(a?.shape, shape), bi = broadcastIndex(b?.shape, shape);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new IntegerCells(size);
    try {
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('computing integer array', end - start);
            for (let i = start; i < end; i++) {
                const x = a ? a.read(ai(i)) : left as bigint;
                const y = b ? b.read(bi(i)) : right as bigint;
                if ((name === 'mod' || name === '//') && y === 0n) return undefined;
                cells.set(i, operation(x, y));
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return cells.array(shape);
}

/** Completed integer operands can produce a compact result without BigInt arithmetic.
 * A result that widens discards the temporary buffer and uses exact arithmetic. */
function mapStoredInt32Binary(left: RankValue, right: RankValue, name: '+' | '-' | '*' | 'gcd'): RankArray | undefined {
    const a = isRankArray(left) ? prepareStoredScalarView(left, true) : undefined;
    const b = isRankArray(right) ? prepareStoredScalarView(right, true) : undefined;
    const eligible = (value: RankValue, view: typeof a) => isRankArray(value)
        ? view?.kinds?.length === 1 && view.kinds[0] === 'integer' && view.linear !== undefined
            && (!view.validate || view.validateUniform !== undefined)
        : typeof value === 'bigint' && value >= -2147483648n && value <= 2147483647n;
    if (!eligible(left, a) || !eligible(right, b) || !a && !b) return undefined;
    const shape = broadcastShape(isRankArray(left) ? left.shape : [], isRankArray(right) ? right.shape : []);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size) {
        if (a) a.validateUniform?.(a.compact ? BigInt(a.compact[a.linear!.offset]) : a.items[a.linear!.offset]);
        if (b) b.validateUniform?.(b.compact ? BigInt(b.compact[b.linear!.offset]) : b.items[b.linear!.offset]);
    }
    const ai = broadcastIndex(isRankArray(left) ? left.shape : undefined, shape);
    const bi = broadcastIndex(isRankArray(right) ? right.shape : undefined, shape);
    const x = a ? 0 : Number(left), y = b ? 0 : Number(right);
    const operation = name === '+' ? (a: number, b: number) => a + b
        : name === '-' ? (a: number, b: number) => a - b
        : name === 'gcd' ? safeIntegerGcd : (a: number, b: number) => a * b;
    const cells = new Int32Array(size);
    for (let start = 0; start < size; start += 4096) {
        const end = Math.min(size, start + 4096);
        checkpoint('computing integer array', end - start);
        for (let i = start; i < end; i++) {
            const ap = a ? a.linear!.offset + ai(i) * a.linear!.stride : 0;
            const bp = b ? b.linear!.offset + bi(i) * b.linear!.stride : 0;
            const av = a ? a.compact ? a.compact[ap] : Number(a.items[ap]) : x;
            const bv = b ? b.compact ? b.compact[bp] : Number(b.items[bp]) : y;
            if (!Number.isSafeInteger(av) || !Number.isSafeInteger(bv)) return undefined;
            const result = operation(av, bv);
            if (result !== (result | 0)) return undefined;
            cells[i] = result;
        }
    }
    return a?.compact || b?.compact ? typedArray(cells, shape)
        : ownedScalarArray(Array.from(cells, BigInt), 'integer', shape);
}

/** Compare completed compact integers directly into a bitmap. Borrowed readers
 * are used only without host callbacks; all other domains keep exact mapping. */
export function compareStoredInt32(left: RankValue, right: RankValue, name?: string): RankArray | undefined {
    const compare = name === 'equal' ? (a: number, b: number) => a === b
        : name === 'notequal' ? (a: number, b: number) => a !== b
        : name === 'less' ? (a: number, b: number) => a < b
        : name === 'greater' ? (a: number, b: number) => a > b
        : name === 'atmost' ? (a: number, b: number) => a <= b
        : name === 'atleast' ? (a: number, b: number) => a >= b : undefined;
    if (!compare || inspectionEnabled() || !privateLoopPolling()) return undefined;
    const a = isRankArray(left) ? prepareStoredScalarView(left, true) : undefined;
    const b = isRankArray(right) ? prepareStoredScalarView(right, true) : undefined;
    const eligible = (value: RankValue, view: typeof a) => isRankArray(value)
        ? view?.compact && view.regular && view.linear && (!view.validate || view.validateUniform)
        : typeof value === 'bigint' && value >= -2147483648n && value <= 2147483647n;
    if (!eligible(left, a) || !eligible(right, b) || !a && !b) return undefined;
    const shape = broadcastShape(isRankArray(left) ? left.shape : [], isRankArray(right) ? right.shape : []);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size < DENSE_MIN_CELLS) return undefined;
    try {
        if (size) {
            if (a) a.validateUniform?.(BigInt(a.compact![a.linear!.offset]));
            if (b) b.validateUniform?.(BigInt(b.compact![b.linear!.offset]));
        }
        const ai = broadcastIndex(isRankArray(left) ? left.shape : undefined, shape);
        const bi = broadcastIndex(isRankArray(right) ? right.shape : undefined, shape);
        const readA = a ? (i: number) => a.compact![a.linear!.offset + ai(i) * a.linear!.stride] : () => Number(left);
        const readB = b ? (i: number) => b.compact![b.linear!.offset + bi(i) * b.linear!.stride] : () => Number(right);
        const cells = new BooleanCells(size);
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('comparing integer array', end - start);
            for (let i = start; i < end; i++) {
                if (compare(readA(i), readB(i))) cells.words[i >>> 5] |= 1 << (i & 31);
            }
        }
        return createOwned(cells, shape, true);
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
}

/** Select stored integer branches without boxing the output or mask cells.
 * Unread masks/branches and non-booleans retain the ordinary demand path. */
export function chooseStoredIntegers(
    condition: RankValue, whenTrue: RankValue, whenFalse: RankValue, shape: readonly number[],
): RankArray | undefined {
    if (inspectionEnabled() || !privateLoopPolling()) return undefined;
    const mask = isRankArray(condition) ? booleanCells(condition) : undefined;
    if (isRankArray(condition) ? !mask : typeof condition !== 'boolean') return undefined;
    const yes = isRankArray(whenTrue) ? prepareIntegerView(whenTrue, true) : undefined;
    const no = isRankArray(whenFalse) ? prepareIntegerView(whenFalse, true) : undefined;
    if (isRankArray(whenTrue) ? !yes?.regular : typeof whenTrue !== 'bigint') return undefined;
    if (isRankArray(whenFalse) ? !no?.regular : typeof whenFalse !== 'bigint') return undefined;
    const mi = broadcastIndex(isRankArray(condition) ? condition.shape : undefined, shape);
    const yi = broadcastIndex(yes?.shape, shape), ni = broadcastIndex(no?.shape, shape);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new IntegerCells(size);
    try {
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('selecting integer array', end - start);
            for (let i = start; i < end; i++) {
                const selected = mask ? mask.read(mi(i)) : condition;
                cells.set(i, selected ? (yes ? yes.read(yi(i)) : whenTrue as bigint)
                    : (no ? no.read(ni(i)) : whenFalse as bigint));
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return cells.array(shape);
}

/** A pure internal ternary operation over completed integer storage. Domain
 * failures return to the demand mapper so unread errors stay deferred. */
export function mapStoredIntegerTernary(args: readonly RankValue[],
    operation: (a: bigint, b: bigint, c: bigint) => bigint,
    smallOperation?: (a: number, b: number, c: number) => number | undefined): RankArray | undefined {
    if (inspectionEnabled() || !privateLoopPolling()) return undefined;
    if (smallOperation) {
        const small = mapStoredInt32Ternary(args, smallOperation);
        if (small) return small;
    }
    const views = args.map(value => isRankArray(value) ? prepareIntegerView(value, true) : undefined);
    if (args.some((value, i) => isRankArray(value) ? !views[i]?.regular : typeof value !== 'bigint')) return undefined;
    if (!views.some(Boolean)) return undefined;
    const shape = views.reduce<readonly number[]>((shape, view) => broadcastShape(shape, view?.shape ?? []), []);
    const readers = views.map((view, i) => {
        const offset = broadcastIndex(view?.shape, shape);
        return view ? (index: number) => view.read(offset(index)) : (_: number) => args[i] as bigint;
    });
    const [a, b, c] = readers;
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new IntegerCells(size);
    try {
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('computing integer array', end - start);
            for (let i = start; i < end; i++) cells.set(i, operation(a(i), b(i), c(i)));
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return cells.array(shape);
}

/** Borrow Number cells only from proven integer storage, and publish a packed
 * result only if every input is safe and every output fits signed 32 bits. */
function mapStoredInt32Ternary(args: readonly RankValue[],
    operation: (a: number, b: number, c: number) => number | undefined): RankArray | undefined {
    const views = args.map(value => prepareStoredScalarView(value, true));
    if (args.some((value, i) => isRankArray(value)
        ? !views[i]?.linear || !views[i]?.kinds?.every(kind => kind === 'integer')
        : typeof value !== 'bigint' || !Number.isSafeInteger(Number(value)))) return undefined;
    if (!args.some(isRankArray)) return undefined;
    const shape = args.filter(isRankArray).reduce<readonly number[]>((shape, array) => broadcastShape(shape, array.shape), []);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new Int32Array(size);
    if (size === 0) return typedArray(cells, shape);
    try {
        const readers = views.map((view, i): ((index: number) => number | undefined) => {
            if (!view) {
                const scalar = Number(args[i]);
                return (_: number) => scalar;
            }
            const { offset, stride } = view.linear!;
            const indexOf = broadcastIndex(isRankArray(args[i]) ? args[i].shape : undefined, shape);
            view.validateUniform?.(view.items[offset]);
            if (view.compact && view.validateUniform) {
                const compact = view.compact;
                return index => compact[offset + indexOf(index) * stride];
            }
            if (view.items instanceof BigInt64Array && view.validateUniform) {
                // Borrow both words rather than boxing each BigInt64 cell.
                // Multiples of 2^32 and their safe integer sums are exact.
                const words = new Uint32Array(view.items.buffer, view.items.byteOffset, view.items.length * 2);
                return index => {
                    const position = 2 * (offset + indexOf(index) * stride);
                    const number = (words[position + 1 - lowWord] | 0) * 4294967296 + words[position + lowWord];
                    return Number.isSafeInteger(number) ? number : undefined;
                };
            }
            return index => {
                const logical = indexOf(index);
                const cell = view.items[offset + logical * stride];
                if (!view.validateUniform) view.validate?.(cell, logical);
                const number = Number(cell);
                return Number.isSafeInteger(number) ? number : undefined;
            };
        });
        const [a, b, c] = readers;
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('computing integer array', end - start);
            for (let i = start; i < end; i++) {
                const x = a(i), y = b(i), z = c(i);
                if (x === undefined || y === undefined || z === undefined) return undefined;
                const result = operation(x, y, z);
                if (result === undefined || result !== (result | 0)) return undefined;
                cells[i] = result;
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return typedArray(cells, shape);
}

function broadcastIndex(operand: readonly number[] | undefined, shape: readonly number[]): (index: number) => number {
    if (!operand) return (_: number) => 0;
    const mod = trailingCells(operand, shape);
    if (mod === 0) return (i: number) => i;
    if (mod > 0) return (i: number) => i % mod;
    const strides = arrayStrides(operand);
    return (i: number) => broadcastOffset(i, shape, operand, strides);
}
