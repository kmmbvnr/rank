import { DENSE_MIN_CELLS } from './tensor-operands.js';
import { BooleanCells } from '../boolean-cells.js';
import { createOwned } from '../owned-array.js';
import { booleanCells, IntegerCells, ownedScalarArray, typedArray } from '../array-storage.js';
import { greatestCommonDivisor, safeIntegerGcd } from '../integer-gcd.js';
import { RankError } from '../errors.js';
import { modularPowerQuad, safeIntegerModularPower } from '../modular-power.js';
import { prepareIntegerView, prepareStoredScalarView } from '../integer-view.js';
import { checkpoint, inspectionEnabled, InterruptedError, privateLoopPolling } from '../interrupt.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import { arrayStrides, broadcastOffset, broadcastShape, trailingCells } from './tensor-layout.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';

const MAX_SAFE = 9007199254740991n, MAX_SAFE_NUMBER = Number.MAX_SAFE_INTEGER;
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
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
    if (name === 'band' || name === 'bor' || name === 'bxor' || name === 'shl' || name === 'shr') {
        return inspectionEnabled() || !privateLoopPolling() ? undefined : mapStoredBitwise(left, right, name);
    }
    if (!operation || inspectionEnabled() || !privateLoopPolling()) return undefined;
    if (name === '+' || name === '-' || name === '*' || name === 'gcd' || name === 'mod' || name === '//' || name === 'min' || name === 'max') {
        try {
            const compact = mapStoredInt32Binary(left, right, name);
            if (compact) return compact;
            // Wide cells times a 0/1 mask need no product.
            if (name === '*') {
                const masked = mapStoredBitwise(left, right, 'mask');
                if (masked) return masked;
            }
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

/** One tight loop per operation over Int32 cells. A result outside Int32 or a zero
 * divisor declines, so the general kernel keeps wide and error cases exact. */
function compactBinary(code: number, a: Int32Array, ao: number, as: number,
    b: Int32Array, bo: number, bs: number, size: number): Int32Array | undefined {
    const out = new Int32Array(size);
    for (let start = 0; start < size; start += 4096) {
        const end = Math.min(size, start + 4096);
        checkpoint('computing integer array', end - start);
        switch (code) {
            case 0: for (let i = start; i < end; i++) {
                const r = a[ao + i * as] + b[bo + i * bs];
                if (r !== (r | 0)) return undefined;
                out[i] = r;
            } break;
            case 1: for (let i = start; i < end; i++) {
                const r = a[ao + i * as] - b[bo + i * bs];
                if (r !== (r | 0)) return undefined;
                out[i] = r;
            } break;
            case 2: for (let i = start; i < end; i++) {
                const r = a[ao + i * as] * b[bo + i * bs];
                if (r !== (r | 0)) return undefined;
                out[i] = r;
            } break;
            case 3: for (let i = start; i < end; i++) {
                const u = a[ao + i * as], v = b[bo + i * bs];
                if (v === 0) return undefined;
                const r = u % v;
                out[i] = r !== 0 && r < 0 !== v < 0 ? r + v : r;
            } break;
            case 4: for (let i = start; i < end; i++) {
                const u = a[ao + i * as], v = b[bo + i * bs];
                if (v === 0) return undefined;
                const r = u % v, q = (u - (r !== 0 && r < 0 !== v < 0 ? r + v : r)) / v;
                if (q !== (q | 0)) return undefined;
                out[i] = q;
            } break;
            case 5: for (let i = start; i < end; i++) {
                const u = a[ao + i * as], v = b[bo + i * bs];
                out[i] = v < u ? v : u;
            } break;
            default: for (let i = start; i < end; i++) {
                const u = a[ao + i * as], v = b[bo + i * bs];
                out[i] = v > u ? v : u;
            }
        }
    }
    return out;
}

/** Completed integer operands can produce a compact result without BigInt arithmetic.
 * A result that widens discards the temporary buffer and uses exact arithmetic. */
function mapStoredInt32Binary(left: RankValue, right: RankValue, name: '+' | '-' | '*' | 'gcd' | 'mod' | '//' | 'min' | 'max'): RankArray | undefined {
    const a = isRankArray(left) ? prepareStoredScalarView(left, true) : undefined;
    const b = isRankArray(right) ? prepareStoredScalarView(right, true) : undefined;
    const eligible = (value: RankValue, view: typeof a) => isRankArray(value)
        ? view?.kinds?.length === 1 && view.kinds[0] === 'integer' && view.linear !== undefined
            && (!view.validate || view.validateUniform !== undefined)
        : typeof value === 'bigint' && value >= -MAX_SAFE && value <= MAX_SAFE;
    if (!eligible(left, a) || !eligible(right, b) || !a && !b) return undefined;
    const shape = broadcastShape(isRankArray(left) ? left.shape : [], isRankArray(right) ? right.shape : []);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size) {
        if (a) a.validateUniform?.(a.compact ? BigInt(a.compact[a.linear!.offset]) : a.items[a.linear!.offset]);
        if (b) b.validateUniform?.(b.compact ? BigInt(b.compact[b.linear!.offset]) : b.items[b.linear!.offset]);
    }
    const x = a ? 0 : Number(left), y = b ? 0 : Number(right);
    const code = name === '+' ? 0 : name === '-' ? 1 : name === '*' ? 2 : name === 'mod' ? 3
        : name === '//' ? 4 : name === 'min' ? 5 : name === 'max' ? 6 : 7;
    // Equal shapes address both operands in place, with no broadcast mapping.
    const sameShape = (value: RankValue) => !isRankArray(value) || same(value.shape, shape);
    const ai = sameShape(left) ? undefined : broadcastIndex(isRankArray(left) ? left.shape : undefined, shape);
    const bi = sameShape(right) ? undefined : broadcastIndex(isRankArray(right) ? right.shape : undefined, shape);
    const ac = a?.compact, ab = a?.items, bc = b?.compact, bb = b?.items;
    // Int64 cells are read as two Int32 words: no BigInt per cell.
    const words = (items: ArrayLike<RankValue> | undefined) => items instanceof BigInt64Array
        ? new Int32Array(items.buffer, items.byteOffset, items.length * 2) : undefined;
    const aw = words(ab), bw = words(bb);
    const ao = a?.linear!.offset ?? 0, as = a?.linear!.stride ?? 0, bo = b?.linear!.offset ?? 0, bs = b?.linear!.stride ?? 0;
    const fast = !ai && !bi && code < 7 && (!a || ac) && (!b || bc) && x === (x | 0) && y === (y | 0)
        ? compactBinary(code, ac ?? Int32Array.of(x), a ? ao : 0, a ? as : 0,
            bc ?? Int32Array.of(y), b ? bo : 0, b ? bs : 0, size) : undefined;
    if (fast) return typedArray(fast, shape);
    // Allocate wide scratch only after the compact path declines. Most stored
    // Int32 operations finish above and would discard this buffer unused.
    // Results beyond Int32 stay exact while they are safe integers; any other
    // result is left to the BigInt path.
    const cells = new Float64Array(size);
    let wide = false;
    for (let start = 0; start < size; start += 4096) {
        const end = Math.min(size, start + 4096);
        checkpoint('computing integer array', end - start);
        for (let i = start; i < end; i++) {
            const ap = a ? ao + (ai ? ai(i) : i) * as : 0;
            const bp = b ? bo + (bi ? bi(i) : i) * bs : 0;
            const av = a ? ac ? ac[ap] : aw ? aw[2 * ap + 1 - lowWord] * 4294967296 + (aw[2 * ap + lowWord] >>> 0) : Number(ab![ap]) : x;
            const bv = b ? bc ? bc[bp] : bw ? bw[2 * bp + 1 - lowWord] * 4294967296 + (bw[2 * bp + lowWord] >>> 0) : Number(bb![bp]) : y;
            if (!(av >= -MAX_SAFE_NUMBER && av <= MAX_SAFE_NUMBER) || !(bv >= -MAX_SAFE_NUMBER && bv <= MAX_SAFE_NUMBER)) return undefined;
            let result: number;
            switch (code) {
                case 0: result = av + bv; break;
                case 1: result = av - bv; break;
                case 2: result = av * bv; break;
                case 3: case 4: {
                    if (bv === 0) return undefined;
                    const r = av % bv, m = r !== 0 && r < 0 !== bv < 0 ? r + bv : r;
                    result = code === 3 ? m : (av - m) / bv;
                    break;
                }
                case 5: result = bv < av ? bv : av; break;
                case 6: result = bv > av ? bv : av; break;
                default: result = safeIntegerGcd(av, bv);
            }
            if (result !== (result | 0)) {
                if (!(result >= -MAX_SAFE_NUMBER && result <= MAX_SAFE_NUMBER)) return undefined;
                wide = true;
            }
            cells[i] = result;
        }
    }
    // One typed operand makes typed cells; only all-boxed operands keep boxed cells.
    const typed = (view: typeof a) => !!view && (!!view.compact || view.items instanceof BigInt64Array);
    const packed = typed(a) || typed(b);
    if (wide) {
        if (packed) {
            const out = new BigInt64Array(size), pair = new Int32Array(out.buffer);
            for (let i = 0; i < size; i++) {
                const high = Math.floor(cells[i] / 4294967296);
                pair[2 * i + lowWord] = cells[i] - high * 4294967296 | 0;
                pair[2 * i + 1 - lowWord] = high;
            }
            return typedArray(out, shape);
        }
        return ownedScalarArray(Array.from(cells, BigInt), 'integer', shape);
    }
    const narrow = Int32Array.from(cells);
    return packed ? typedArray(narrow, shape)
        : ownedScalarArray(Array.from(narrow, BigInt), 'integer', shape);
}

/** Bitwise operations on Int32/Int64 storage, one Int32 word pair per cell.
 * A shift that leaves the Int64 range, a negative count, a product by anything
 * but 0 or 1 or boxed operands decline, so the exact BigInt path produces the value or the error. */
function mapStoredBitwise(left: RankValue, right: RankValue, name: 'band' | 'bor' | 'bxor' | 'shl' | 'shr' | 'mask'): RankArray | undefined {
    const a = isRankArray(left) ? prepareStoredScalarView(left, true) : undefined;
    const b = isRankArray(right) ? prepareStoredScalarView(right, true) : undefined;
    const typed = (view: typeof a) => view?.compact || view?.items instanceof BigInt64Array;
    const eligible = (value: RankValue, view: typeof a) => isRankArray(value)
        ? view?.kinds?.length === 1 && view.kinds[0] === 'integer' && view.linear !== undefined
            && typed(view) && (!view.validate || view.validateUniform !== undefined)
        : typeof value === 'bigint' && value >= -(1n << 63n) && value < 1n << 63n;
    if (!eligible(left, a) || !eligible(right, b) || !a && !b) return undefined;
    const shape = broadcastShape(isRankArray(left) ? left.shape : [], isRankArray(right) ? right.shape : []);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size) {
        if (a) a.validateUniform?.(a.compact ? BigInt(a.compact[a.linear!.offset]) : a.items[a.linear!.offset]);
        if (b) b.validateUniform?.(b.compact ? BigInt(b.compact[b.linear!.offset]) : b.items[b.linear!.offset]);
    }
    const scalarHigh = (value: RankValue) => Number(BigInt.asIntN(32, (value as bigint) >> 32n));
    const scalarLow = (value: RankValue) => Number(BigInt.asIntN(32, value as bigint));
    const xh = a ? 0 : scalarHigh(left), xl = a ? 0 : scalarLow(left);
    const yh = b ? 0 : scalarHigh(right), yl = b ? 0 : scalarLow(right);
    const code = name === 'band' ? 0 : name === 'bor' ? 1 : name === 'bxor' ? 2 : name === 'shl' ? 3 : name === 'shr' ? 4 : 5;
    const out = new BigInt64Array(size), ow = new Int32Array(out.buffer);
    const sameShape = (value: RankValue) => !isRankArray(value) || same(value.shape, shape);
    const ai = sameShape(left) ? undefined : broadcastIndex(isRankArray(left) ? left.shape : undefined, shape);
    const bi = sameShape(right) ? undefined : broadcastIndex(isRankArray(right) ? right.shape : undefined, shape);
    const ac = a?.compact, bc = b?.compact;
    const words = (items: ArrayLike<RankValue> | undefined) => items instanceof BigInt64Array
        ? new Int32Array(items.buffer, items.byteOffset, items.length * 2) : undefined;
    const aw = words(a?.items), bw = words(b?.items);
    const ao = a?.linear!.offset ?? 0, as = a?.linear!.stride ?? 0, bo = b?.linear!.offset ?? 0, bs = b?.linear!.stride ?? 0;
    const hi = 1 - lowWord;
    let wide = false;
    for (let start = 0; start < size; start += 4096) {
        const end = Math.min(start + 4096, size);
        checkpoint('computing integer array', end - start);
        for (let i = start; i < end; i++) {
            const ap = a ? ao + (ai ? ai(i) : i) * as : 0;
            const bp = b ? bo + (bi ? bi(i) : i) * bs : 0;
            let ah = xh, al = xl, bh = yh, bl = yl;
            if (a) {
                if (ac) { al = ac[ap]; ah = al >> 31; } else { al = aw![2 * ap + lowWord]; ah = aw![2 * ap + hi]; }
            }
            if (b) {
                if (bc) { bl = bc[bp]; bh = bl >> 31; } else { bl = bw![2 * bp + lowWord]; bh = bw![2 * bp + hi]; }
            }
            let rh: number, rl: number;
            if (code === 5) {
                // Only a product by 0 or 1 is exact here; any other factor declines.
                if (bh === 0 && bl >>> 0 <= 1) { rh = bl ? ah : 0; rl = bl ? al : 0; }
                else if (ah === 0 && al >>> 0 <= 1) { rh = al ? bh : 0; rl = al ? bl : 0; }
                else return undefined;
            } else if (code < 3) {
                if (code === 0) { rh = ah & bh; rl = al & bl; }
                else if (code === 1) { rh = ah | bh; rl = al | bl; }
                else { rh = ah ^ bh; rl = al ^ bl; }
            } else {
                // The count is the right operand: a nonnegative value of up to 2^32 - 1 or more.
                if (bh < 0) return undefined;
                const n = bh > 0 || bl >>> 0 > 64 ? 64 : bl >>> 0;
                if (code === 4) {
                    if (n >= 64) { rh = ah >> 31; rl = rh; }
                    else if (n >= 32) { rl = ah >> (n - 32); rh = ah >> 31; }
                    else if (n === 0) { rh = ah; rl = al; }
                    else { rl = al >>> n | ah << 32 - n; rh = ah >> n; }
                } else if (n === 0) { rh = ah; rl = al; }
                else if (n >= 64) {
                    if (ah !== 0 || al !== 0) return undefined;
                    rh = 0; rl = 0;
                } else {
                    let backHigh: number, backLow: number;
                    if (n >= 32) {
                        rh = al << n - 32; rl = 0;
                        backLow = rh >> n - 32; backHigh = rh >> 31;
                    } else {
                        rh = ah << n | al >>> 32 - n; rl = al << n;
                        backLow = rl >>> n | rh << 32 - n; backHigh = rh >> n;
                    }
                    // A value that does not shift back left the Int64 range.
                    if (backHigh !== ah || backLow !== al) return undefined;
                }
            }
            ow[2 * i + lowWord] = rl;
            ow[2 * i + hi] = rh;
            if (rh !== rl >> 31) wide = true;
        }
    }
    if (wide) return typedArray(out, shape);
    const narrow = new Int32Array(size);
    for (let i = 0; i < size; i++) narrow[i] = ow[2 * i + lowWord];
    return typedArray(narrow, shape);
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
    const code = ['equal', 'notequal', 'less', 'greater', 'atmost', 'atleast'].indexOf(name ?? '');
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
        const sameA = !isRankArray(left) || same(left.shape, shape), sameB = !isRankArray(right) || same(right.shape, shape);
        if (sameA && sameB && code >= 0) {
            // Equal shapes or scalars: index the borrowed cells directly, no closure per cell.
            const ac = a?.compact ?? Int32Array.of(Number(left)), bc = b?.compact ?? Int32Array.of(Number(right));
            const ao = a ? a.linear!.offset : 0, as = a ? a.linear!.stride : 0;
            const bo = b ? b.linear!.offset : 0, bs = b ? b.linear!.stride : 0;
            const words = cells.words;
            for (let start = 0; start < size; start += 4096) {
                const end = Math.min(size, start + 4096);
                checkpoint('comparing integer array', end - start);
                for (let i = start; i < end; i++) {
                    const u = ac[ao + i * as], v = bc[bo + i * bs];
                    const hit = code === 0 ? u === v : code === 1 ? u !== v : code === 2 ? u < v
                        : code === 3 ? u > v : code === 4 ? u <= v : u >= v;
                    if (hit) words[i >>> 5] |= 1 << (i & 31);
                }
            }
            return createOwned(cells, shape, true);
        }
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

/** powmod of packed Int32 bases with one scalar exponent and modulus. Four
 * bases run in lockstep; anything else returns to the general mapper. */
export function powerStoredInt32(base: RankValue, exponent: RankValue, modulus: RankValue): RankArray | undefined {
    if (inspectionEnabled() || !privateLoopPolling() || !isRankArray(base)
        || typeof exponent !== 'bigint' || typeof modulus !== 'bigint'
        || exponent < 0n || exponent > 4294967295n || modulus < 1n || modulus > 1073741824n) return undefined;
    const view = prepareStoredScalarView(base, true);
    if (!view?.linear || !view.compact || !view.validateUniform
        || !view.kinds?.every(kind => kind === 'integer')) return undefined;
    const { offset, stride } = view.linear;
    const e = Number(exponent), m = Number(modulus);
    const size = base.shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new Int32Array(size);
    view.validateUniform(view.items[offset]);
    const compact = view.compact;
    try {
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('computing integer array', end - start);
            let i = start;
            for (; i + 4 <= end; i += 4) {
                const at = offset + i * stride;
                if (compact[at] < 0 || compact[at] >= m || compact[at + stride] < 0 || compact[at + stride] >= m
                    || compact[at + 2 * stride] < 0 || compact[at + 2 * stride] >= m
                    || compact[at + 3 * stride] < 0 || compact[at + 3 * stride] >= m) break;
                modularPowerQuad(compact, at, stride, e, m, cells, i);
            }
            for (; i < end; i++) cells[i] = safeIntegerModularPower(compact[offset + i * stride], e, m);
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return typedArray(cells, base.shape);
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
