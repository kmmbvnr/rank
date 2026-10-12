import { RankError } from './errors.js';
import { ownedArray } from './array-storage.js';
import { mapBroadcastArrays } from './tensor.js';
import { isRankArray, MISSING, tuple, type RankValue } from './value.js';

export function divideWithRemainder(left: RankValue, right: RankValue): RankValue {
    if (!isRankArray(left) && !isRankArray(right)) return tuple(divmod(left, right));
    const a = isRankArray(left) ? left : ownedArray([left], []);
    const b = isRankArray(right) ? right : ownedArray([right], []);
    return tuple([
        mapBroadcastArrays(a, b, (x, y) => divmod(x, y)[0]),
        mapBroadcastArrays(a, b, (x, y) => divmod(x, y)[1]),
    ]);
}

export function floorDivideReal(left: number, right: number, remainder = left % right): number {
    // Derive the quotient from the remainder so rounding near an integer
    // boundary cannot make // disagree with %.
    let quotient = (left - remainder) / right;
    if (remainder !== 0 && (remainder < 0) !== (right < 0)) quotient -= 1;
    if (quotient === 0) {
        const ratio = left / right;
        return ratio < 0 || Object.is(ratio, -0) ? -0 : 0;
    }
    const floor = Math.floor(quotient);
    return quotient - floor > 0.5 ? floor + 1 : floor;
}

export function floorDivide(left: bigint, right: bigint): bigint {
    const quotient = left / right;
    const remainder = left % right;
    return remainder !== 0n && (left < 0n) !== (right < 0n)
        ? quotient - 1n
        : quotient;
}

/** A quotient rounded down and a remainder with the divisor's sign. */
function divmod(left: RankValue, right: RankValue): [RankValue, RankValue] {
    if (left === MISSING || right === MISSING) return [MISSING, MISSING];
    if ((typeof left !== 'bigint' && typeof left !== 'number')
        || (typeof right !== 'bigint' && typeof right !== 'number')) {
        throw new RankError('divmod expects numeric input', 'TypeError');
    }
    if (right === 0n || right === 0) throw new RankError('division by zero');
    if (typeof left === 'bigint' && typeof right === 'bigint') {
        const quotient = left / right;
        const remainder = left % right;
        return remainder !== 0n && (remainder < 0n) !== (right < 0n)
            ? [quotient - 1n, remainder + right] : [quotient, remainder];
    }
    const a = Number(left), b = Number(right);
    const remainder = a % b;
    return [floorDivideReal(a, b, remainder), remainder === 0 ? (b < 0 ? -0 : 0)
        : (remainder < 0) !== (b < 0) ? remainder + b : remainder];
}
