import { readArrayItem } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { requireSameNumericType } from './numeric-types.js';
import { compareOrderedValues, orderedKind } from './ordered.js';
import {
    formatValue, isRankTuple, isRankArray, isRankDate, isRankDuration, isRankRecord,
    type RankValue,
} from './value.js';

const arrayItem = readArrayItem;
const arraySize = (shape: readonly number[]): number => shape.reduce((size, axis) => size * axis, 1);
const sameShape = (left: readonly number[], right: readonly number[]): boolean =>
    left.length === right.length && left.every((axis, index) => axis === right[index]);

export function compareCells(operator: string, left: RankValue, right: RankValue): boolean {
    if (operator === 'equal' || operator === 'notequal') {
        const equal = equalValues(left, right);
        return operator === 'equal' ? equal : !equal;
    }
    const order = compareCellOrder(left, right, new WeakMap());
    if (operator === 'less') return order < 0;
    if (operator === 'greater') return order > 0;
    if (operator === 'atleast') return order >= 0;
    return order <= 0;
}

function compareCellOrder(left: RankValue, right: RankValue, compared: WeakMap<object, WeakSet<object>>): number {
    if (isRankArray(left) && isRankArray(right)) {
        if (alreadyCompared(left, right, compared)) return 0;
        const a = arraySize(left.shape), b = arraySize(right.shape);
        for (let index = 0; index < Math.min(a, b); index++) {
            checkpoint('comparing cells');
            const order = compareCellOrder(arrayItem(left, index), arrayItem(right, index), compared);
            if (order) return order;
        }
        if (a !== b) return a - b;
        for (let axis = 0; axis < Math.min(left.shape.length, right.shape.length); axis++) {
            if (left.shape[axis] !== right.shape[axis]) return left.shape[axis] - right.shape[axis];
        }
        return left.shape.length - right.shape.length;
    }
    return compareOrderedValues(left, right, orderedKind(left));
}

export function equalValues(left: RankValue, right: RankValue): boolean {
    return equalNestedValues(left, right, new WeakMap(), true);
}

// Membership retains value-based numeric keys, including nested record fields.
export function equalMembershipValues(left: RankValue, right: RankValue): boolean {
    return equalNestedValues(left, right, new WeakMap(), false);
}

function equalNestedValues(
    left: RankValue,
    right: RankValue,
    compared: WeakMap<object, WeakSet<object>>,
    strictNumericTypes: boolean,
): boolean {
    if ((typeof left === 'bigint' || typeof left === 'number')
        && (typeof right === 'bigint' || typeof right === 'number')) {
        if (strictNumericTypes) requireSameNumericType(left, right);
        if (typeof left === typeof right) return left === right;
        const integer = typeof left === 'bigint' ? left : right as bigint;
        const real = typeof left === 'number' ? left : right as number;
        return Number.isFinite(real) && Number.isInteger(real) && integer === BigInt(real);
    }
    if (typeof left !== 'object' || typeof right !== 'object') {
        return left === right;
    }
    if (left.kind === 'label' && right.kind === 'label') {
        return left.name === right.name;
    }
    if (isRankDate(left) && isRankDate(right)) {
        return left.kind === right.kind && formatValue(left) === formatValue(right);
    }
    if (isRankDuration(left) && isRankDuration(right)) {
        return left.seconds === right.seconds;
    }
    if (isRankTuple(left) && isRankTuple(right)) {
        if (left.items.length !== right.items.length) return false;
        if (alreadyCompared(left, right, compared)) return true;
        return left.items.every((item, index) => equalNestedValues(item, right.items[index], compared, strictNumericTypes));
    }
    if (isRankArray(left) && isRankArray(right)) {
        if (!sameShape(left.shape, right.shape)) return false;
        if (alreadyCompared(left, right, compared)) return true;
        const size = arraySize(left.shape);
        for (let index = 0; index < size; index += 1) {
            if (!equalNestedValues(arrayItem(left, index), arrayItem(right, index), compared, strictNumericTypes)) {
                return false;
            }
        }
        return true;
    }
    if (isRankRecord(left) && isRankRecord(right)) {
        if (left.entries.size !== right.entries.size) return false;
        if (alreadyCompared(left, right, compared)) return true;
        for (const [name, value] of left.entries) {
            const other = right.entries.get(name);
            if (other === undefined || !equalNestedValues(value, other, compared, strictNumericTypes)) return false;
        }
        return true;
    }
    return left === right;
}

function alreadyCompared(
    left: object,
    right: object,
    compared: WeakMap<object, WeakSet<object>>,
): boolean {
    const matches = compared.get(left);
    if (matches?.has(right)) return true;
    if (matches) matches.add(right);
    else compared.set(left, new WeakSet([right]));
    return false;
}
